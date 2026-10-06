# BOSS X PRIME — Device Access

## Deploy
1. Upload this project to Railway/Render/etc.
2. Set environment variables from `.env.example`.
3. Run `npm install` then `npm start` (the platform can run `npm start`).
4. For Telegram notifications, create a Telegram bot and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
5. Change `ADMIN_PASSWORD` and `SESSION_SECRET` before production.

## Important
- The browser creates a random device ID and stores it in localStorage.
- Each access request creates a new one-time 6-digit code.
- Codes expire according to `CODE_TTL_MINUTES`.
- Telegram receives the device ID and code when configured.
- This is a starter authentication system; for high-security production use, add HTTPS, rate limiting, persistent server-side sessions, and a stronger device-attestation strategy.
