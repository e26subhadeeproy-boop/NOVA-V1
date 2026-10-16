$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$distRoot = Join-Path $projectRoot "dist"
$appDir = Join-Path $distRoot "NOVA"

if (-not (Test-Path $python)) { throw "Run Setup NOVA.bat first to create the Python environment." }
& $python -m pip install -r (Join-Path $projectRoot "requirements-build.txt")
if ($LASTEXITCODE -ne 0) { throw "Installing desktop build requirements failed with exit code $LASTEXITCODE." }
foreach ($modelPath in @("models\Qwen3-0.6B\config.json", "models\Qwen2.5-Coder-0.5B-Instruct\config.json")) {
    if (-not (Test-Path (Join-Path $projectRoot $modelPath))) { throw "Required local model is missing: $modelPath" }
}

Push-Location $projectRoot
try {
    & $python -m PyInstaller --noconfirm --clean --onedir --console `
        --name NOVA `
        --distpath $distRoot `
        --workpath (Join-Path $projectRoot "build\pyinstaller") `
        --specpath (Join-Path $projectRoot "build") `
        --additional-hooks-dir (Join-Path $PSScriptRoot "hooks") `
        --collect-submodules transformers.models.qwen2 `
        --collect-submodules transformers.models.qwen3 `
        --collect-all tokenizers `
        --collect-all safetensors `
        --collect-all psutil `
        --hidden-import training.assistant `
        --hidden-import memory.nova_memory `
        nova_exe.py
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE." }

    Copy-Item -LiteralPath (Join-Path $projectRoot "ui") -Destination $appDir -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot "models") -Destination $appDir -Recurse -Force
    foreach ($folder in @("config", "memory", "logs")) {
        New-Item -ItemType Directory -Force -Path (Join-Path $appDir $folder) | Out-Null
    }
    Write-Host "Desktop executable created: $appDir\NOVA.exe"
    Write-Host "The full distribution includes local models and may be several GB."
} finally {
    Pop-Location
}
