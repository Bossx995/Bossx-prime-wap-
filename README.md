# BOSS X PRIME Device Access

This project uses a separate one-time 6-digit device password for each browser/device.

Flow:
1. User opens the website.
2. The browser creates a unique device ID and sends an access request.
3. The server generates a new 6-digit password for that device.
4. The password is sent to the configured Telegram bot/chat.
5. User enters the password on the website.
6. The password is marked used and cannot be reused.
7. A device session is created.

Railway variables:
- ADMIN_PASSWORD
- SESSION_SECRET
- CODE_TTL_MINUTES (optional, default 30)
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- NODE_ENV=production

Keep secrets only in Railway Variables. Do not put Telegram tokens or admin passwords in HTML.
