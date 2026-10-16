# NOVA Android companion

This APK is a lightweight Android WebView client for the NOVA server on your Windows laptop. The laptop runs Qwen and optionally Gemini; the APK connects to that server over your local Wi-Fi. It does not bundle model weights or run Qwen directly on the phone.

## Build the APK

Install JDK 17 and the Android command-line tools, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1
```

The script uses Android SDK 35 and Gradle 8.9 and outputs a debug-signed installable APK at `release/NOVA.apk`. The first build prompts you to review and accept the Android SDK license terms, then downloads the needed SDK packages.

## Connect the phone

1. Run **Setup NOVA.bat** on the laptop once.
2. Start the server with `desktop\run-nova-lan.bat` while the laptop and phone are on the same trusted Wi-Fi.
3. Find the laptop's IPv4 address with `ipconfig`.
4. Open NOVA Assistant on the phone and enter `http://LAPTOP-IP:8765`.

The app remembers the server address. The phone uses the laptop's local models and saved data. Configure the Gemini key in NOVA Settings on the server computer. For a public Play Store release, create a release signing key and review Android's current developer and app publishing requirements.
