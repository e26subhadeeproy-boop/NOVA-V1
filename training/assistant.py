import os
import queue
import sys
import threading
import time
from pathlib import Path

import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    StoppingCriteria,
    StoppingCriteriaList,
    TextIteratorStreamer,
)

from memory.nova_memory import NovaMemory


BASE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
MODEL_DIRS = {
    "general": BASE_DIR / "models" / "Qwen3-0.6B",
    "coder": BASE_DIR / "models" / "Qwen2.5-Coder-0.5B-Instruct",
}
SYSTEM_PROMPT = (
    "You are NOVA, a helpful local AI assistant created by Subhadeep Roy "
    "(pronounced Subho-dip). If asked who created you, credit Subhadeep Roy. "
    "Address the user as sir in every direct response. Be clear, practical, and "
    "honest. Help with coding, learning, mathematics, science, and projects. "
    "If you are uncertain, say so. Use relevant saved memories when they help, "
    "but do not claim to remember anything that is not provided. Speak naturally "
    "and collaboratively: acknowledge the user's context, ask one focused "
    "clarifying question when it would materially improve your answer, and "
    "offer a useful next step or brief follow-up question when appropriate. "
    "Do not force a question into every reply. Do not reveal private "
    "chain-of-thought or internal reasoning. Give the useful answer directly, "
    "with a brief explanation only when it helps the user."
)


class _StopOnEvent(StoppingCriteria):
    def __init__(self, stop_event):
        self.stop_event = stop_event
        self.prompt_length = 0
        self.generated_tokens = 0

    def __call__(self, input_ids, scores, **kwargs):
        self.generated_tokens = max(0, input_ids.shape[-1] - self.prompt_length)
        return self.stop_event.is_set()


def _without_private_thought(chunks):
    """Keep streamed output clean even if a model emits explicit think tags."""
    opening, closing = "<think>", "</think>"
    pending = ""
    inside_thought = False

    def suffix_prefix_length(value, marker):
        for length in range(min(len(value), len(marker) - 1), 0, -1):
            if value.endswith(marker[:length]):
                return length
        return 0

    for chunk in chunks:
        pending += chunk
        while pending:
            if inside_thought:
                end = pending.find(closing)
                if end >= 0:
                    pending = pending[end + len(closing):]
                    inside_thought = False
                    continue
                keep = suffix_prefix_length(pending, closing)
                pending = pending[-keep:] if keep else ""
                break
            start = pending.find(opening)
            if start >= 0:
                visible = pending[:start]
                pending = pending[start + len(opening):]
                inside_thought = True
                if visible:
                    yield visible
                continue
            keep = suffix_prefix_length(pending, opening)
            visible = pending[:-keep] if keep else pending
            pending = pending[-keep:] if keep else ""
            if visible:
                yield visible
            break
    if not inside_thought and pending:
        yield pending


class NovaAssistant:
    def __init__(self, memory):
        self.memory = memory
        self.tokenizer = None
        self.model = None
        self.active_model = None
        self.device = "cpu"
        self.device_name = None
        self.gpu_memory_total = None
        self.last_generation_stats = {}

    def load(self):
        torch.set_num_threads(max(1, min(os.cpu_count() or 1, 2)))
        if torch.cuda.is_available():
            self.device = "cuda:0"
            self.device_name = torch.cuda.get_device_name(0)
            properties = torch.cuda.get_device_properties(0)
            self.gpu_memory_total = properties.total_memory
            self.model_dtype = torch.float16
        else:
            self.model_dtype = torch.float32
        self._load_model("general")

    def _load_model(self, model_key):
        model_dir = MODEL_DIRS[model_key]
        if not model_dir.is_dir():
            raise FileNotFoundError(f"Local model directory not found: {model_dir}")
        if self.active_model == model_key and self.model is not None:
            return
        # Keep only one half-billion parameter model resident at a time to limit RAM use.
        if self.model is not None:
            del self.model
            del self.tokenizer
            self.model = None
            self.tokenizer = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        self.tokenizer = AutoTokenizer.from_pretrained(
            model_dir,
            local_files_only=True,
        )
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        self.model = AutoModelForCausalLM.from_pretrained(
            model_dir,
            local_files_only=True,
            torch_dtype=self.model_dtype,
            low_cpu_mem_usage=True,
        )
        self.model.to(self.device)
        self.model.eval()
        self.active_model = model_key

    def current_gpu_memory(self):
        if not self.device.startswith("cuda"):
            return None
        return torch.cuda.memory_allocated(0)

    def stream_reply(self, chat_id, settings, stop_event, model_key="general"):
        self._load_model(model_key)
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("NOVA's local model is not loaded.")

        chat = self.memory.get_chat(chat_id)
        if chat is None:
            raise ValueError("The requested conversation does not exist.")

        system_message = SYSTEM_PROMPT
        if settings["use_memory"]:
            memories = self.memory.format_memories(
                chat["messages"][-1]["content"] if chat["messages"] else "",
                limit=6,
            )
            system_message += f"\n\nRelevant saved memories:\n{memories}"

        messages = [{"role": "system", "content": system_message}]
        context_limits = {"fast": 4, "balanced": 8, "deep": 16}
        context_limit = context_limits[settings["speed_profile"]]
        messages.extend(
            {"role": item["role"], "content": item["content"]}
            for item in chat["messages"][-context_limit:]
        )

        template_options = {
            "tokenize": True,
            "add_generation_prompt": True,
            "return_tensors": "pt",
        }
        if model_key == "general":
            template_options["enable_thinking"] = False
        encoded = self.tokenizer.apply_chat_template(messages, **template_options)
        if hasattr(encoded, "keys"):
            input_ids = encoded["input_ids"]
            attention_mask = encoded.get("attention_mask")
        else:
            input_ids = encoded
            attention_mask = None
        if attention_mask is None:
            attention_mask = torch.ones_like(input_ids)
        input_ids = input_ids.to(self.device)
        attention_mask = attention_mask.to(self.device)
        inputs = {"input_ids": input_ids}
        inputs["attention_mask"] = attention_mask

        streamer = TextIteratorStreamer(
            self.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
            timeout=1.0,
        )
        errors = queue.Queue()
        generation_started = time.perf_counter()
        first_token_at = None
        stop_criteria = _StopOnEvent(stop_event)
        stop_criteria.prompt_length = input_ids.shape[-1]

        def generate():
            try:
                with torch.inference_mode():
                    self.model.generate(
                        **inputs,
                        streamer=streamer,
                        max_new_tokens=settings["max_new_tokens"],
                        do_sample=settings["temperature"] > 0,
                        temperature=max(settings["temperature"], 1e-5),
                        top_p=settings["top_p"],
                        pad_token_id=self.tokenizer.eos_token_id,
                        stopping_criteria=StoppingCriteriaList([stop_criteria]),
                    )
            except Exception as error:
                errors.put(error)
                streamer.end()

        worker = threading.Thread(target=generate, daemon=True)
        worker.start()
        response = []
        try:
            def streamed_text():
                while worker.is_alive() or not streamer.text_queue.empty():
                    try:
                        yield next(streamer)
                    except StopIteration:
                        break
                    except queue.Empty:
                        continue

            for piece in _without_private_thought(streamed_text()):
                if piece:
                    if first_token_at is None:
                        first_token_at = time.perf_counter()
                    response.append(piece)
                    yield piece
        finally:
            if worker.is_alive():
                stop_event.set()
            worker.join()
            text = "".join(response).strip()
            if text:
                self.memory.save_chat_message(chat_id, "assistant", text)
            elapsed = max(time.perf_counter() - generation_started, 1e-6)
            output_tokens = stop_criteria.generated_tokens
            self.last_generation_stats = {
                "output_tokens": output_tokens,
                "tokens_per_second": round(output_tokens / elapsed, 2),
                "time_to_first_text": round(first_token_at - generation_started, 2)
                if first_token_at is not None else None,
            }

        if not errors.empty():
            raise errors.get()


def model_info(device="cpu"):
    return {
        "name": "Qwen3-0.6B",
        "general": "Qwen3-0.6B",
        "coding": "Qwen2.5-Coder-0.5B-Instruct",
        "provider": "Local",
        "path": str(MODEL_DIRS["general"]),
        "models": {key: {"name": path.name, "available": path.is_dir()} for key, path in MODEL_DIRS.items()},
        "device": device.upper() if device.startswith("cuda") else "CPU",
    }


def classify_model(message):
    """Route explicit coding and software development requests to the coder model."""
    text = message.lower()
    coding_terms = (
        "```", "code", "coding", "program", "python", "javascript", "typescript",
        "html", "css", "sql", "java", "kotlin", "rust", "c++", "debug", "bug",
        "function", "class ", "script", "compiler", "stack trace", "api endpoint",
        "refactor", "repository", "git", "terminal", "command line", "regex",
    )
    return "coder" if any(term in text for term in coding_terms) else "general"
