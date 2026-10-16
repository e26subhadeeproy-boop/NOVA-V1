import json
import logging
import threading
import time
import uuid
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import psutil

from memory.nova_memory import NovaMemory
from training.assistant import NovaAssistant, classify_model, model_info, SYSTEM_PROMPT


BASE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
UI_DIR = BASE_DIR / "ui"
SETTINGS_FILE = BASE_DIR / "config" / "ui_settings.json"
SECRETS_FILE = BASE_DIR / "config" / "secrets.json"
AUTOMATIONS_FILE = BASE_DIR / "config" / "automations.json"
ACTIVITY_FILE = BASE_DIR / "logs" / "activity.json"
DEFAULT_SETTINGS = {
    "temperature": 0.7,
    "top_p": 0.9,
    "max_new_tokens": 32,
    "speed_profile": "fast",
    "use_memory": True,
    "ai_provider": "auto",
}
SPEED_PROFILES = {"fast", "balanced", "deep"}
MAX_REQUEST_BYTES = 1_000_000
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

memory = NovaMemory()
assistant = NovaAssistant(memory)
model_state = {"status": "loading", "error": None}
generation_lock = threading.Lock()
active_generation = {"id": None, "stop_event": None}


def load_settings():
    if not SETTINGS_FILE.is_file():
        return DEFAULT_SETTINGS.copy()
    with SETTINGS_FILE.open("r", encoding="utf-8") as file:
        stored = json.load(file)
    return validate_settings({**DEFAULT_SETTINGS, **stored})


def validate_settings(settings):
    try:
        temperature = float(settings["temperature"])
        top_p = float(settings["top_p"])
        max_new_tokens = int(settings["max_new_tokens"])
        speed_profile = settings["speed_profile"]
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Settings contain invalid sampling values.") from error
    ai_provider = settings.get("ai_provider", "auto")
    if not 0 <= temperature <= 2:
        raise ValueError("Temperature must be between 0 and 2.")
    if not 0.05 <= top_p <= 1:
        raise ValueError("Top-p must be between 0.05 and 1.")
    if not 16 <= max_new_tokens <= 1024:
        raise ValueError("Maximum output tokens must be between 16 and 1024.")
    if not isinstance(settings.get("use_memory"), bool):
        raise ValueError("Memory setting must be true or false.")
    if not isinstance(speed_profile, str) or speed_profile not in SPEED_PROFILES:
        raise ValueError("Speed profile must be fast, balanced, or deep.")
    if ai_provider not in {"auto", "local"}:
        raise ValueError("AI provider must be auto or local.")
    return {
        "temperature": temperature,
        "top_p": top_p,
        "max_new_tokens": max_new_tokens,
        "speed_profile": speed_profile,
        "use_memory": settings["use_memory"],
        "ai_provider": ai_provider,
    }


def gemini_api_key():
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return key.strip()
    try:
        value = json.loads(SECRETS_FILE.read_text(encoding="utf-8"))
        return value.get("gemini_api_key", "").strip() if isinstance(value, dict) else ""
    except (OSError, json.JSONDecodeError):
        return ""


def gemini_model_name():
    value = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash").strip()
    return value if value and all(c.isalnum() or c in "._-" for c in value) else "gemini-3.8-flash"


def open_gemini_stream(chat, settings, key, model_name, current_prompt):
    context_limits = {"fast": 4, "balanced": 8, "deep": 16}
    history = (chat["messages"] + [{"role": "user", "content": current_prompt}])[-context_limits[settings["speed_profile"]]:]
    system_text = SYSTEM_PROMPT
    if settings["use_memory"]:
        memories = memory.format_memories(history[-1]["content"] if history else "", limit=6)
        system_text += f"\\n\\nRelevant saved memories:\\n{memories}"
    contents = [
        {"role": "model" if item["role"] == "assistant" else "user", "parts": [{"text": item["content"]}]}
        for item in history
    ]
    url = "https://generativelanguage.googleapis.com/v1beta/models/" + urllib.parse.quote(model_name, safe="._-") + ":streamGenerateContent?alt=sse"
    payload = {
        "systemInstruction": {"parts": [{"text": system_text}]},
        "contents": contents,
        "generationConfig": {
            "temperature": settings["temperature"],
            "topP": settings["top_p"],
            "maxOutputTokens": settings["max_new_tokens"],
        },
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    return urllib.request.urlopen(request, timeout=18)


def gemini_error_message(error):
    try:
        payload = json.loads(error.read().decode("utf-8"))
        return payload.get("error", {}).get("message") or f"Gemini API returned HTTP {error.code}."
    except (ValueError, OSError, UnicodeDecodeError):
        return f"Gemini API returned HTTP {error.code}."


def save_settings(settings):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(
        json.dumps(settings, indent=2) + "\n",
        encoding="utf-8",
    )


def load_automations():
    defaults = {"desktop_greeting": True, "mobile_greeting": True}
    if not AUTOMATIONS_FILE.is_file():
        return defaults
    try:
        saved = json.loads(AUTOMATIONS_FILE.read_text(encoding="utf-8"))
        return {key: saved.get(key, value) is True for key, value in defaults.items()}
    except (OSError, json.JSONDecodeError):
        return defaults


def save_activity(entry):
    ACTIVITY_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        entries = json.loads(ACTIVITY_FILE.read_text(encoding="utf-8")) if ACTIVITY_FILE.is_file() else []
    except (OSError, json.JSONDecodeError):
        entries = []
    entries.insert(0, entry)
    ACTIVITY_FILE.write_text(json.dumps(entries[:100], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_model():
    try:
        assistant.load()
        model_state.update(status="ready", error=None)
        logging.info("NOVA model loaded.")
    except Exception as error:
        model_state.update(status="error", error=str(error))
        logging.exception("Unable to load NOVA's local model.")


def system_info():
    memory = psutil.virtual_memory()
    cpu_percent = psutil.cpu_percent(interval=None)
    gpu = {
        "available": assistant.device.startswith("cuda"),
        "name": None,
        "memory_used_gb": None,
        "memory_total_gb": None,
        "memory_percent": None,
    }
    if gpu["available"]:
        gpu["name"] = assistant.device_name
        total = assistant.gpu_memory_total
        used = assistant.current_gpu_memory()
        gpu["memory_total_gb"] = round(total / (1024 ** 3), 2) if total else None
        gpu["memory_used_gb"] = round(used / (1024 ** 3), 2) if used is not None else None
        if total and used is not None:
            gpu["memory_percent"] = round(used / total * 100, 1)

    warnings = []
    if memory.percent >= 85:
        warnings.append("System memory usage is high.")
    if cpu_percent >= 90:
        warnings.append("CPU usage is very high.")
    if gpu["memory_percent"] is not None and gpu["memory_percent"] >= 85:
        warnings.append("GPU memory usage is high.")
    process_memory = psutil.Process().memory_info().rss
    return {
        "cpu_percent": round(cpu_percent, 1),
        "ram_used_gb": round(memory.used / (1024 ** 3), 2),
        "ram_total_gb": round(memory.total / (1024 ** 3), 2),
        "ram_percent": round(memory.percent, 1),
        "process_ram_gb": round(process_memory / (1024 ** 3), 2),
        "gpu": gpu,
        "warnings": warnings,
    }


class NovaRequestHandler(BaseHTTPRequestHandler):
    server_version = "NOVA/1.0"

    def log_message(self, format_string, *args):
        logging.info("%s - %s", self.address_string(), format_string % args)

    def _send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Request body is empty or exceeds the 1 MB limit.")
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request body must be valid JSON.") from error
        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object.")
        return body

    def _path_parts(self):
        return [unquote(part) for part in urlparse(self.path).path.split("/") if part]

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = self._path_parts()
        try:
            if parts == ["api", "status"]:
                self._send_json(200, {
                    **model_state,
                    "model": model_info(assistant.device),
                    "system": system_info(),
                    "settings": load_settings(),
                    "gemini": {"configured": bool(gemini_api_key()), "model": gemini_model_name()},
                })
                return
            if parts == ["api", "settings"]:
                self._send_json(200, load_settings())
                return
            if parts == ["api", "automations"]:
                self._send_json(200, load_automations())
                return
            if parts == ["api", "activity"]:
                entries = json.loads(ACTIVITY_FILE.read_text(encoding="utf-8")) if ACTIVITY_FILE.is_file() else []
                self._send_json(200, {"entries": entries[:30]})
                return
            if parts == ["api", "chats"]:
                query = parse_qs(parsed.query).get("q", [""])[0]
                self._send_json(200, {"chats": memory.list_chats(query=query)})
                return
            if len(parts) == 3 and parts[:2] == ["api", "chats"]:
                chat = memory.get_chat(parts[2])
                if chat is None:
                    self._send_json(404, {"error": "Conversation not found."})
                else:
                    self._send_json(200, chat)
                return
            if parts == ["api", "memories"]:
                query = parse_qs(parsed.query).get("q", [""])[0]
                self._send_json(200, {"memories": memory.recall(query=query)})
                return
            self._serve_static(parsed.path)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            self._send_json(500, {"error": str(error)})

    def _serve_static(self, request_path):
        relative = "index.html" if request_path in {"", "/"} else request_path.lstrip("/")
        target = (UI_DIR / relative).resolve()
        if not target.is_relative_to(UI_DIR.resolve()) or not target.is_file():
            self._send_json(404, {"error": "Page not found."})
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(target.suffix.lower(), "application/octet-stream")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        parts = self._path_parts()
        try:
            body = self._read_json()
            if parts == ["api", "chats"]:
                chat_id = str(uuid.uuid4())
                memory.create_chat(chat_id)
                self._send_json(201, memory.get_chat(chat_id))
                return
            if parts == ["api", "stop"]:
                requested_id = body.get("generation_id")
                if (
                    requested_id
                    and active_generation["id"] == requested_id
                    and active_generation["stop_event"] is not None
                ):
                    active_generation["stop_event"].set()
                    self._send_json(200, {"stopping": True})
                else:
                    self._send_json(200, {"stopping": False})
                return
            if len(parts) == 4 and parts[:2] == ["api", "chats"] and parts[3] == "stream":
                self._stream_chat(parts[2], body)
                return
            if parts == ["api", "memories"]:
                text = body.get("memory")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("Memory text is required.")
                memory.remember(text, body.get("category", "general"))
                self._send_json(201, {"memories": memory.recall(query=text, limit=1)})
                return
            if parts == ["api", "activity"]:
                message = body.get("message")
                platform = body.get("platform")
                if not isinstance(message, str) or not message.strip() or len(message) > 500:
                    raise ValueError("Activity message must contain 1 to 500 characters.")
                if platform not in {"desktop", "mobile"}:
                    raise ValueError("Platform must be desktop or mobile.")
                entry = {"type": "greeting", "message": message.strip(), "platform": platform, "created_at": datetime.now(timezone.utc).isoformat()}
                save_activity(entry)
                self._send_json(201, entry)
                return
            self._send_json(404, {"error": "Endpoint not found."})
        except ValueError as error:
            self._send_json(400, {"error": str(error)})

    def _stream_chat(self, chat_id, body):
        chat = memory.get_chat(chat_id)
        if chat is None:
            self._send_json(404, {"error": "Conversation not found."})
            return
        text = body.get("message")
        if not isinstance(text, str) or not text.strip():
            self._send_json(400, {"error": "Message text is required."})
            return
        requested_settings = body.get("settings", {})
        if not isinstance(requested_settings, dict):
            self._send_json(400, {"error": "Settings must be a JSON object."})
            return
        try:
            settings = validate_settings({**load_settings(), **requested_settings})
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        if not generation_lock.acquire(blocking=False):
            self._send_json(409, {"error": "A response is already being generated."})
            return

        try:
            key = gemini_api_key()
            use_gemini = settings["ai_provider"] == "auto" and bool(key)
            model_name = gemini_model_name()
            gemini_response = None
            provider = "local"
            if use_gemini:
                try:
                    # Open the upstream stream before sending SSE headers so network
                    # failures can cleanly fall back to local Qwen.
                    gemini_response = open_gemini_stream(chat, settings, key, model_name, text.strip())
                    provider = "gemini"
                except urllib.error.HTTPError as error:
                    self._send_json(502, {"error": gemini_error_message(error)})
                    return
                except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
                    logging.info("Gemini is unreachable; falling back to local Qwen: %s", error)
                    provider = "local-fallback"
            if provider != "gemini" and model_state["status"] != "ready":
                self._send_json(503, {"error": model_state["error"] or "The local model is still loading."})
                return
            generation_id = body.get("generation_id") or str(uuid.uuid4())
            stop_event = threading.Event()
            active_generation.update(id=generation_id, stop_event=stop_event)
            memory.save_chat_message(chat_id, "user", text.strip())

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            def send_event(event, payload):
                data = json.dumps(payload, ensure_ascii=False)
                self.wfile.write(f"event: {event}\ndata: {data}\n\n".encode("utf-8"))
                self.wfile.flush()

            started_at = time.perf_counter()
            send_event("start", {"generation_id": generation_id, "provider": provider})
            model_key = classify_model(text)
            response_parts = []
            first_text_at = None
            if provider == "gemini":
                try:
                    for raw_line in gemini_response:
                        if stop_event.is_set():
                            break
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        try:
                            item = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            continue
                        for candidate in item.get("candidates", []):
                            for part in candidate.get("content", {}).get("parts", []):
                                piece = part.get("text", "")
                                if piece and not part.get("thought", False):
                                    if first_text_at is None:
                                        first_text_at = time.perf_counter()
                                    response_parts.append(piece)
                                    send_event("token", {"text": piece})
                    response_text = "".join(response_parts).strip()
                    if response_text:
                        memory.save_chat_message(chat_id, "assistant", response_text)
                    elapsed = max(time.perf_counter() - started_at, 0.000001)
                    estimated_tokens = max(1, round(len(response_text) / 4)) if response_text else 0
                    stats = {
                        "output_tokens": estimated_tokens,
                        "tokens_per_second": round(estimated_tokens / elapsed, 2),
                        "time_to_first_text": round(first_text_at - started_at, 2) if first_text_at else None,
                    }
                    display_model = model_name
                finally:
                    gemini_response.close()
            else:
                stream = assistant.stream_reply(chat_id, settings, stop_event, model_key=model_key)
                for piece in stream:
                    send_event("token", {"text": piece})
                stats = assistant.last_generation_stats
                display_model = "Qwen2.5-Coder-0.5B-Instruct" if model_key == "coder" else "Qwen3-0.6B"
            send_event("done", {
                "stopped": stop_event.is_set(),
                "model": display_model,
                "provider": provider,
                **stats,
                "elapsed_seconds": round(time.perf_counter() - started_at, 2),
            })
        except (BrokenPipeError, ConnectionResetError):
            if "stop_event" in locals():
                stop_event.set()
            if "stream" in locals():
                stream.close()
        except Exception as error:
            logging.exception("NOVA response generation failed.")
            if "send_event" in locals():
                try:
                    send_event("error", {"error": str(error)})
                except (BrokenPipeError, ConnectionResetError):
                    logging.info("Client disconnected before receiving the generation error.")
            elif not self.wfile.closed:
                self._send_json(500, {"error": str(error)})
        finally:
            active_generation.update(id=None, stop_event=None)
            generation_lock.release()

    def do_PUT(self):
        parts = self._path_parts()
        try:
            body = self._read_json()
            if parts == ["api", "gemini-key"]:
                key = body.get("api_key")
                if not isinstance(key, str) or not key.strip() or len(key.strip()) > 512:
                    raise ValueError("Enter a valid Gemini API key.")
                if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
                    raise ValueError("Gemini key is set by an environment variable; update that variable to change it.")
                SECRETS_FILE.parent.mkdir(parents=True, exist_ok=True)
                SECRETS_FILE.write_text(json.dumps({"gemini_api_key": key.strip()}, indent=2) + "\n", encoding="utf-8")
                self._send_json(200, {"configured": True})
                return
            if parts == ["api", "settings"]:
                settings = validate_settings({**load_settings(), **body})
                save_settings(settings)
                self._send_json(200, settings)
                return
            if parts == ["api", "automations"]:
                current = load_automations()
                for key in current:
                    if key in body and not isinstance(body[key], bool):
                        raise ValueError(f"{key} must be true or false.")
                    current[key] = body.get(key, current[key])
                AUTOMATIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
                AUTOMATIONS_FILE.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
                self._send_json(200, current)
                return
            if len(parts) == 3 and parts[:2] == ["api", "chats"]:
                if memory.get_chat(parts[2]) is None:
                    self._send_json(404, {"error": "Conversation not found."})
                    return
                memory.update_chat(
                    parts[2],
                    title=body.get("title"),
                    pinned=body.get("pinned"),
                    archived=body.get("archived"),
                )
                self._send_json(200, memory.get_chat(parts[2]))
                return
            if len(parts) == 3 and parts[:2] == ["api", "memories"]:
                text = body.get("memory")
                if not isinstance(text, str):
                    raise ValueError("Memory text is required.")
                memory.update_memory(
                    int(parts[2]),
                    text,
                    body.get("category", "general"),
                )
                self._send_json(200, {"ok": True})
                return
            self._send_json(404, {"error": "Endpoint not found."})
        except (ValueError, TypeError) as error:
            self._send_json(400, {"error": str(error)})

    def do_DELETE(self):
        parts = self._path_parts()
        try:
            if parts == ["api", "gemini-key"]:
                if SECRETS_FILE.exists():
                    SECRETS_FILE.unlink()
                self._send_json(200, {"configured": bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))})
                return
            if len(parts) == 3 and parts[:2] == ["api", "chats"]:
                memory.delete_chat(parts[2])
                self._send_json(200, {"ok": True})
                return
            if len(parts) == 3 and parts[:2] == ["api", "memories"]:
                memory.forget(int(parts[2]))
                self._send_json(200, {"ok": True})
                return
            if parts == ["api", "memories"]:
                body = self._read_json()
                if body.get("confirm") is not True:
                    raise ValueError("Explicit confirmation is required to clear memory.")
                memory.clear_memories()
                self._send_json(200, {"ok": True})
                return
            self._send_json(404, {"error": "Endpoint not found."})
        except (ValueError, TypeError) as error:
            self._send_json(400, {"error": str(error)})


def main():
    loader = threading.Thread(target=load_model, daemon=True)
    loader.start()
    host = os.environ.get("NOVA_HOST", "127.0.0.1")
    port = 8765
    server = ThreadingHTTPServer((host, port), NovaRequestHandler)
    print(f"NOVA is starting at http://{host}:{port}")
    print("Press Ctrl+C to stop the local server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping NOVA.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
