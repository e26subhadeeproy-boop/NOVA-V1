@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo First-time setup is required. NOVA will install its dependencies and local models.
  call "%~dp0Setup NOVA.bat"
  if errorlevel 1 exit /b 1
)
if not exist "models\Qwen3-0.6B\config.json" call "%~dp0Setup NOVA.bat"
if errorlevel 1 exit /b 1
if not exist "models\Qwen2.5-Coder-0.5B-Instruct\config.json" call "%~dp0Setup NOVA.bat"
if errorlevel 1 exit /b 1
start "NOVA Server (minimized)" /min "%~dp0.venv\Scripts\python.exe" "%~dp0nova_app.py"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddMinutes(3); while ((Get-Date) -lt $deadline) { try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2; if ($response.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:8765/loading.html'; exit 0 } } catch { }; Start-Sleep -Milliseconds 500 }; Write-Host 'NOVA did not start within 3 minutes. Check the minimized server window.'; pause"
