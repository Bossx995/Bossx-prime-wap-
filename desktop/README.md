# BOSS X PRIME Desktop Mode

This wrapper turns the existing BOSS X PRIME web UI into a Chromium/Electron desktop app and loads the bundled **BOSS Premium Mic** extension into the same browser session.

## Why this matters

A normal webpage cannot directly replace WhatsApp Web's private WebRTC microphone track. The bundled extension runs on `web.whatsapp.com` and performs the audio processing in the browser context. The desktop wrapper makes the extension part of the BOSS X PRIME browser session.

## Run

1. Install Node.js 20+.
2. From the project root run `npm install`.
3. Set `BOSS_WEB_URL` to your deployed Railway URL, for example:

   `BOSS_WEB_URL=https://your-app.up.railway.app/ npm run desktop`

   On Windows PowerShell:

   `$env:BOSS_WEB_URL="https://your-app.up.railway.app/"; npm run desktop`

4. The app opens BOSS X PRIME. Activate the license, then open WhatsApp Web.

## Important

- The Railway backend remains responsible for license validation, PostgreSQL and Telegram admin commands.
- The desktop app does not expose the extension ZIP as a public download.
- WhatsApp Web can change its WebRTC internals at any time; the extension hook is therefore not guaranteed to survive future WhatsApp changes.
