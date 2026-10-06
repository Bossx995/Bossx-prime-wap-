# BOSS X PRIME Device Access

This project uses a separate one-time 6-digit device password for each browser/device.

Flow:
1. User opens the website.
2. The browser creates a unique device ID and sends an access request.
3. The device request appears in the Admin Panel. The administrator chooses a plan and the server generates a one-time 6-digit password.
4. The approved password and expiry are sent to the configured Telegram bot/chat.
5. User enters the password on the website.
6. The password is marked used and cannot be reused.
7. A device session is created.

Railway variables:
- ADMIN_PASSWORD
- SESSION_SECRET
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- NODE_ENV=production

Keep secrets only in Railway Variables. Do not put Telegram tokens or admin passwords in HTML.

Access plans: 1 Day (24 hours), 1 Month (30 days), 6 Months (180 days), and Unlimited (until revoked). The password is single-use and tied to one browser device ID. The server checks plan expiry on protected requests.
