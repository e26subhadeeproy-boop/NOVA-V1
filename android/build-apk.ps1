$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = "8.9"
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
$androidCli = Join-Path $sdkRoot "cmdline-tools\latest\bin\android.exe"
$gradleHome = Join-Path $env:LOCALAPPDATA "NOVA\tools\gradle-$version"
$gradleExe = Join-Path $gradleHome "bin\gradle.bat"

if (-not (Test-Path $sdkManager)) {
    $metadata = [xml](Invoke-WebRequest -Uri "https://dl.google.com/android/repository/repository2-1.xml" -UseBasicParsing).Content
    $package = $metadata.SelectSingleNode("//*[local-name()='remotePackage' and @path='cmdline-tools;latest']")
    $archiveUrl = $null
    foreach ($archiveInfo in $package.SelectNodes(".//*[local-name()='archive']")) {
        if ($archiveInfo.SelectSingleNode("./*[local-name()='host-os']").InnerText -eq "windows") {
            $archiveUrl = $archiveInfo.SelectSingleNode(".//*[local-name()='complete']/*[local-name()='url']").InnerText
            break
        }
    }
    if (-not $archiveUrl) { throw "Could not find the official Windows Android SDK command-line tools download." }
    $toolRoot = Join-Path $sdkRoot "cmdline-tools"
    $tempRoot = Join-Path $env:TEMP "nova-android-tools"
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    $toolsZip = Join-Path $tempRoot "commandlinetools.zip"
    Invoke-WebRequest -Uri "https://dl.google.com/android/repository/$archiveUrl" -OutFile $toolsZip
    Expand-Archive -LiteralPath $toolsZip -DestinationPath $tempRoot -Force
    New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
    Move-Item -LiteralPath (Join-Path $tempRoot "cmdline-tools") -Destination (Join-Path $toolRoot "latest") -Force
    Remove-Item -LiteralPath $toolsZip -Force
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
    $sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
}
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

if (-not (Test-Path $gradleExe)) {
    $toolsDir = Split-Path -Parent $gradleHome
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $archive = Join-Path $toolsDir "gradle-$version-bin.zip"
    Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-$version-bin.zip" -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir -Force
    Remove-Item -LiteralPath $archive -Force
}

Write-Host "Installing Android SDK Platform 35 and Build Tools 35.0.0."
if (Test-Path $androidCli) {
    & $androidCli "--sdk=$sdkRoot" sdk install "platforms/android-35" "build-tools/35.0.0" "platform-tools"
} else {
    Write-Host "Accept the displayed Google SDK licenses in the SDK Manager prompt."
    & $sdkManager "--sdk_root=$sdkRoot" --licenses
    if ($LASTEXITCODE -ne 0) { throw "Android SDK license setup was not completed." }
    & $sdkManager "--sdk_root=$sdkRoot" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
}
if ($LASTEXITCODE -ne 0) { throw "Android SDK package installation failed." }

Push-Location $PSScriptRoot
try {
    & $gradleExe --no-daemon --stacktrace :app:assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed with exit code $LASTEXITCODE." }
    $apk = Join-Path $PSScriptRoot "app\build\outputs\apk\debug\app-debug.apk"
    $release = Join-Path $projectRoot "release"
    New-Item -ItemType Directory -Force -Path $release | Out-Null
    Copy-Item -LiteralPath $apk -Destination (Join-Path $release "NOVA.apk") -Force
    Write-Host "Debug APK created: $release\NOVA.apk"
} finally {
    Pop-Location
}
