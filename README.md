# NOVA

NOVA is a local-first AI assistant created by **Subhadeep Roy** (pronounced **Subho-dip**). It routes coding requests to Qwen2.5-Coder-0.5B-Instruct and general requests to Qwen3-0.6B. When configured, its Auto provider uses Gemini while online and falls back to the local Qwen model if Gemini cannot be reached. Local-only mode keeps prompts on the device.

## Features

- Separate text and voice modes, with text-only operation while offline
- Optional Gemini streaming with a server-side API key
- Automatic local Qwen fallback when the network connection to Gemini fails
- Local chat history and saved memories, with a setting to disable memory context
- Responsive desktop/mobile interface, animated NOVA avatar, activity log, and greeting automations
- Local resource telemetry and adjustable response profiles

## Contents

- [Quick start](#quick-start-on-windows)
- [Build desktop and Android apps](#build-desktop-and-android-apps)
- [Local models](#local-models)
- [Configure Gemini](#configure-gemini)
- [Data and privacy](#data-and-privacy)
- [Project layout](#project-layout)
- [Development and checks](#development-and-checks)
- [GitHub release preparation](#github-release-preparation)

## Build desktop and Android apps

- Windows executable: run `powershell -ExecutionPolicy Bypass -File desktop\build.ps1`. It creates `dist\NOVA\NOVA.exe` with the UI and both local models beside it. The distribution is several GB because it includes model weights.
- Android companion: run `powershell -ExecutionPolicy Bypass -File android\build-apk.ps1`. It creates `release\NOVA.apk`. The phone app connects to NOVA running on your laptop over the same Wi-Fi; see [android/README.md](android/README.md). It does not contain model weights.

## Quick start on Windows

1. Install Python 3.11 or 3.12 and ensure the Python launcher (`py`) is available.
2. Double-click **Start NOVA.bat**. On first run, it creates a virtual environment, installs dependencies, downloads both local models, then starts NOVA before opening the loading screen and chat. This first setup needs an internet connection and several GB of free disk space.

To run setup explicitly, double-click **Setup NOVA.bat**. Or prepare the Python environment manually in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Then download both model snapshots (one time):

```powershell
.\.venv\Scripts\hf.exe download Qwen/Qwen3-0.6B --local-dir models/Qwen3-0.6B
.\.venv\Scripts\hf.exe download Qwen/Qwen2.5-Coder-0.5B-Instruct --local-dir models/Qwen2.5-Coder-0.5B-Instruct
```

Start the app with `python nova_app.py`.

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). The first startup loads the general Qwen model. Stop the server with `Ctrl+C`.

### PyTorch installation

The command above installs PyTorch using pip's default Windows build. For a specific CPU-only or CUDA build, install the matching PyTorch package from the official [PyTorch installation selector](https://pytorch.org/get-started/locally/), then install the remaining dependencies with `python -m pip install -r requirements.txt`.

## Local models

Setup downloads compatible Hugging Face model snapshots to these paths:

```text
models/Qwen3-0.6B/
models/Qwen2.5-Coder-0.5B-Instruct/
```

Each directory needs its model configuration, tokenizer files, and weight files. NOVA uses `local_files_only=True`; after downloading the models, inference works without network access. The older `models/Qwen2.5-0.5B-Instruct/` folder is only used by the optional legacy training workflow.

## Configure Gemini

1. Start NOVA and open **Settings**.
2. Set **AI provider** to **Auto - Gemini online, local offline**.
3. Create a Gemini API key using [Google AI Studio](https://aistudio.google.com/apikey), paste it in the settings field, and save it.

The key is written to `config/secrets.json`, which is ignored by Git. The API call is made by NOVA's local Python server; the key is not exposed to the browser. You can instead provide `GEMINI_API_KEY` or `GOOGLE_API_KEY` as a server environment variable. Environment variables take precedence over the saved key. `GEMINI_MODEL` optionally changes the default model (`gemini-3.8-flash`).

Auto mode sends the current prompt, recent conversation messages, and relevant saved memories (if **Use saved memories** is enabled) to Gemini. Google processes that content to generate the online response. When NOVA is offline, the browser disables Voice mode and uses text; Auto mode uses local Qwen. Choose **Local Qwen only** to keep all prompts on the device even while online. A configured but invalid or rate-limited Gemini key shows the API error so it can be corrected; network connection failures fall back to local Qwen.

## Data and privacy

- Chat history and saved memories: `memory/nova_memory.db`
- Personal settings and greeting preferences: `config/ui_settings.json` and `config/automations.json`
- Gemini key saved locally: `config/secrets.json`
- Greeting activity: `logs/activity.json`

These runtime files are ignored by Git. Back them up separately if you want to preserve them. See [SECURITY.md](SECURITY.md) before exposing or modifying the local server.

## Project layout

```text
nova_app.py          Local HTTP server and Gemini/Qwen provider routing
training/            Local inference and legacy LoRA training code
memory/              SQLite conversation and memory implementation
ui/                  Responsive web app, voice features, and NOVA avatar
desktop/             Windows launcher scripts
android/             Android wrapper project
dataset/             Legacy training examples
```

## Legacy adapter training

The optional LoRA training script uses the legacy base model and `dataset/train.jsonl`:

```powershell
python training\train_nova.py
```

The current runtime does not load this adapter. The included small training set is for a basic identity/style experiment, not broad model training.

## Development and checks

Install the app and desktop packaging dependencies with:

```powershell
python -m pip install -r requirements-build.txt
```

Run the automated unit tests and Python syntax check:

```powershell
python -m unittest discover -s tests -v
python -m compileall -q nova_app.py nova_exe.py memory training
```

The Android project can be compiled with `android\build-apk.ps1`; see [android/README.md](android/README.md) for SDK and signing notes. The desktop build script requires both local model snapshots and produces a multi-gigabyte onedir distribution.

## GitHub release preparation

Create an empty GitHub repository, then from the project folder initialize Git, review the staged files, and push:

```powershell
git init
git add .
git status --short
git diff --cached --stat
git commit -m "Prepare NOVA local-first assistant"
git branch -M main
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Before pushing, confirm that the staged changes do not include model weights, API keys, `.env` files, local databases, or personal settings. The `.gitignore` excludes those machine-specific files and generated EXE/APK artifacts. Choose and add a `LICENSE` before describing the repository as open source; no license is included because the project owner has not selected redistribution terms.


**Please check the issue section and tell all the bugs**
