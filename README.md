# BOSS X PRIME Browser / Web Hub

This package keeps the original BOSS X PRIME project and adds the complete **BOSS Premium Mic / BOSS(2) Power Audio** extension source under `bundled/BOSS-Premium-Mic/` without removing its controls or files.

## Included
- Original BOSS X PRIME license/password activation flow.
- Telegram admin license generation/listing.
- PostgreSQL support for Railway.
- BOSS X home page and website shortcuts.
- BOSS Premium Mic / Power Audio extension source bundled in the repository.
- Official WhatsApp Web launch/linking button.
- Existing web microphone test and controls remain intact.

## Railway
1. Upload this repository to GitHub.
2. Create a Railway service from the GitHub repository.
3. Add PostgreSQL and set `DATABASE_URL` from Railway.
4. Set `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and `PUBLIC_URL`.
5. Railway starts the service with `npm start`.

## Important browser limitation
A normal Railway-hosted website cannot become a full Chromium browser and cannot silently inject a Chrome extension into WhatsApp Web. The bundled Power Audio package is preserved as a real Manifest V3 extension source package. To make it run as an extension, it must be loaded/packaged by a Chromium-based browser shell or installed as an extension. The web app itself cannot bypass WhatsApp's browser security or directly take over its private WebRTC call stream.

The extension source is intentionally not exposed as a public ZIP download route. This protects casual downloading but cannot make client-side code impossible to inspect once it is executed on a user's device.

## Project layout
- `public/` — BOSS X PRIME web UI.
- `server.js` — Express API, license activation, Telegram bot and PostgreSQL support.
- `bundled/BOSS-Premium-Mic/` — untouched BOSS(2)_POWER_AUDIO extension files.


## Desktop Browser
The project now includes an Electron desktop wrapper under `desktop/`. It loads the bundled BOSS Premium Mic extension into the same Chromium session so WhatsApp Web can use the extension audio hook. See `desktop/README.md`.
