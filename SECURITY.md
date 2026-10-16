# Security policy

## Reporting a vulnerability

Please do not post API keys, personal chat data, or exploitable security reports in a public issue. Contact the repository owner privately with a description and steps to reproduce.

## Local data and API keys

NOVA binds its development server to `127.0.0.1`. Gemini keys are read on the server from `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or the ignored local file `config/secrets.json`. Never commit a real key or expose it in browser code. Rotate any key that was accidentally published.

The optional `desktop/run-nova-lan.bat` launcher binds the server to `0.0.0.0` so the Android companion can connect over Wi-Fi. The local server currently has no authentication or TLS, so any device that can reach that address may be able to read or change NOVA data, including its saved Gemini key. Use this only on a trusted private network, do not forward port 8765 from your router, and close the server when finished. Return to the regular desktop launcher for loopback-only access.

Chat history and memories are stored locally in `memory/nova_memory.db`. The Auto Gemini provider sends the recent conversation context and, when enabled, relevant saved memories to Google for response generation. Select **Local Qwen only** to keep prompts on the device.
