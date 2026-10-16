@echo off
cd /d "%~dp0.."
set NOVA_HOST=0.0.0.0
if not exist ".venv\Scripts\python.exe" (
  echo Run Setup NOVA.bat first.
  pause
  exit /b 1
)
start "NOVA Server for Phone" ".venv\Scripts\python.exe" nova_app.py
echo NOVA is starting for devices on your local Wi-Fi.
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.InterfaceAlias -notmatch 'Virtual|Loopback' } | Select-Object -ExpandProperty IPAddress"
echo Enter one of these addresses in NOVA Assistant on your phone, using port 8765.
pause
