# Quetta + BOSS Premium Mic licensing site

Railway-ready Node/Express web app. It recreates the supplied Quetta-style screen, gates access behind a license password, provides an admin panel, and serves the supplied BOSS Premium Mic extension package.

## Deploy on Railway
1. Create a Railway project and add this repository.
2. Add a PostgreSQL service and expose `DATABASE_URL` to the web service.
3. Set `ADMIN_USER`, `ADMIN_PASSWORD`, and a long random `SESSION_SECRET` in Variables.
4. Deploy. The app listens on Railway's `PORT`.
5. Open `/admin` to generate 1-day, 3-month, and 6-month passwords.

The first activation starts the password timer. A license is locked to the first device ID used for activation. Admin can revoke it.

The BOSS Premium Mic zip is served at `/extensions/BOSS-Premium-Mic.zip`.

Note: a normal website cannot silently install a browser extension. The site provides the extension package and UI; installation still follows the compatible Chromium browser's extension rules.
