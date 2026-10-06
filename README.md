# Quetta BOSS Premium Audio Website

Mobile-first Quetta-style web app for Railway deployment.

## Features
- Quetta-inspired mobile UI matching the supplied screenshots
- WhatsApp / WhatsApp Business / Add shortcuts
- BOSS Premium Mic extension download
- Activation gate with 1 Day, 3 Months and 6 Months passwords
- Password validity starts on first activation
- One-device binding per password
- Admin panel at `/admin`
- Generate, view, revoke and track passwords
- PostgreSQL support through `DATABASE_URL`

## Railway environment variables
- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `DATABASE_URL` (recommended)
- 
