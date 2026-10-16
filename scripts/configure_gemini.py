"""Prompt for Gemini credentials once during first-time Windows setup."""

import getpass
import json
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
SECRETS_FILE = CONFIG_DIR / "secrets.json"
PROMPT_MARKER = CONFIG_DIR / ".gemini_setup_prompted"


def configure_gemini():
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        print("Gemini API key is already configured in the environment.")
        PROMPT_MARKER.parent.mkdir(parents=True, exist_ok=True)
        PROMPT_MARKER.touch(exist_ok=True)
        return

    if PROMPT_MARKER.exists():
        return

    try:
        existing = json.loads(SECRETS_FILE.read_text(encoding="utf-8"))
        if isinstance(existing, dict) and existing.get("gemini_api_key", "").strip():
            print("A Gemini API key is already saved locally; keeping it.")
            PROMPT_MARKER.touch(exist_ok=True)
            return
    except (OSError, json.JSONDecodeError, AttributeError):
        pass

    print("Optional: configure Gemini before NOVA downloads its local models.")
    print("Press Enter to skip and use local Qwen models only.")
    key = getpass.getpass("Paste Gemini API key (input hidden): ").strip()
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if key:
        SECRETS_FILE.write_text(
            json.dumps({"gemini_api_key": key}, indent=2) + "\n",
            encoding="utf-8",
        )
        print("Gemini key saved locally. It is excluded from Git.")
    else:
        print("Skipped Gemini setup. You can add a key later in NOVA Settings.")
    PROMPT_MARKER.touch(exist_ok=True)


if __name__ == "__main__":
    configure_gemini()
