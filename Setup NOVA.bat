@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python 3.11 or 3.12 is required. Install it from https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

echo.
py scripts\configure_gemini.py
if errorlevel 1 goto :failed

if not exist ".venv\Scripts\python.exe" (
  echo Creating NOVA's Python environment...
  py -3.11 -m venv .venv
  if errorlevel 1 py -3.12 -m venv .venv
  if errorlevel 1 goto :failed
)

echo Installing NOVA dependencies. This can take several minutes...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :failed

if not exist "models\Qwen3-0.6B\config.json" (
  echo Downloading Qwen3-0.6B for general replies...
  ".venv\Scripts\hf.exe" download Qwen/Qwen3-0.6B --local-dir models/Qwen3-0.6B
  if errorlevel 1 goto :failed
)
if not exist "models\Qwen2.5-Coder-0.5B-Instruct\config.json" (
  echo Downloading Qwen2.5-Coder-0.5B-Instruct for coding...
  ".venv\Scripts\hf.exe" download Qwen/Qwen2.5-Coder-0.5B-Instruct --local-dir models/Qwen2.5-Coder-0.5B-Instruct
  if errorlevel 1 goto :failed
)

echo.
echo Setup complete. Double-click Start NOVA.bat to run the assistant.
pause
exit /b 0

:failed
echo.
echo Setup did not complete. Check the error above and try again.
pause
exit /b 1
