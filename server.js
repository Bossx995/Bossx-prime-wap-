
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import TelegramBot from 'node-telegram-bot-api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '').trim();

const FIXED_PASSWORDS = {
  oneDay: process.env.BOSS_1D_PASSWORD || '',
  sixMonths: process.env.BOSS_6M_PASSWORD || '',
  unlimited: process.env.BOSS_UNLIMITED_PASSWORD || ''
};

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : null;

const memory = {
  licenses: new Map()
};

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      duration_days INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      device_id TEXT
    )
  `);
}

function makeCode(days) {
  const tag = days === 1 ? '1D' : days === 180 ? '6M' : 'UNL';
  return `BOSS-${tag}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

function cookieValue(payload) {
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET)
    .update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

function readCookie(req, name) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').filter(Boolean).map(v => {
      const i = v.indexOf('=');
      return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
    })
  );
  return cookies[name];
}

function adminRequired(req, res, next) {
  const token = readCookie(req, 'boss_admin');

  if (!token) {
    return res.status(401).json({ error: 'Admin login required' });
  }

  const [raw, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET)
    .update(raw || '').digest('base64url');

  const actualBuffer = Buffer.from(sig || '');
  const expectedBuffer = Buffer.from(expected);

  if (
    !raw ||
    !sig ||
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return res.status(401).json({ error: 'Invalid admin session' });
  }

  try {
    const data = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (data.exp < Date.now() || data.u !== ADMIN_USER) {
      throw new Error('Expired or invalid session');
    }
  } catch {
    return res.status(401).json({ error: 'Admin session expired' });
  }

  next();
}

async function getLicense(code) {
  if (pool) {
    const result = await pool.query(
      'SELECT * FROM licenses WHERE code=$1',
      [code]
    );
    return result.rows[0] || null;
  }
  return memory.licenses.get(code) || null;
}

async function saveLicense(license) {
  if (pool) {
    await pool.query(
      `INSERT INTO licenses
       (code, duration_days, created_at, activated_at, expires_at, revoked_at, device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        license.code, license.duration_days, license.created_at,
        license.activated_at, license.expires_at, license.revoked_at,
        license.device_id
      ]
    );
  } else {
    memory.licenses.set(license.code, license);
  }
}

async function updateLicense(license) {
  if (pool) {
    await pool.query(
      `UPDATE licenses
       SET activated_at=$1, expires_at=$2, revoked_at=$3, device_id=$4
       WHERE code=$5`,
      [
        license.activated_at, license.expires_at,
        license.revoked_at, license.device_id, license.code
      ]
    );
  } else {
    memory.licenses.set(license.code, license);
  }
}

async function listLicenses() {
  if (pool) {
    const result = await pool.query(
      'SELECT * FROM licenses ORDER BY id DESC'
    );
    return result.rows;
  }
  return [...memory.licenses.values()].sort(
    (a, b) => b.created_at.localeCompare(a.created_at)
  );
}

async function generateLicense(duration) {
  let code;
  do {
    code = makeCode(duration);
  } while (await getLicense(code));

  const license = {
    code,
    duration_days: duration,
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    revoked_at: null,
    device_id: null
  };

  await saveLicense(license);
  return license;
}

function planLabel(days) {
  return days === 0 ? 'Unlimited' : days === 1 ? '1 Day' : '6 Months';
}

function startTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log('Telegram bot disabled: missing bot token');
    return;
  }

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  // Check the actual Telegram user ID, including callback queries.
  const isAdmin = user =>
    Boolean(ADMIN_TELEGRAM_ID) &&
    String(user?.from?.id ?? user?.id ?? '') === ADMIN_TELEGRAM_ID;

  const customerMenu = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💎 1 Day', callback_data: 'buy:1' },
          { text: '💎 6 Months', callback_data: 'buy:180' }
        ],
        [{ text: '♾️ Unlimited', callback_data: 'buy:0' }]
      ]
    }
  };

  const adminMenu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔑 Generate 1 Day', callback_data: 'gen:1' }],
        [{ text: '🔑 Generate 6 Months', callback_data: 'gen:180' }],
        [{ text: '🔑 Generate Unlimited', callback_data: 'gen:0' }],
        [{ text: '📋 Password List', callback_data: 'list:all' }]
      ]
    }
  };

  bot.onText(/^\/start$/, async msg => {
    try {
      await bot.sendMessage(
        msg.chat.id,
        '👑 *BOSS X PRIME*\n\nChoose your plan. Contact the admin for payment and your password.',
        { ...customerMenu, parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Start command error:', error);
    }
  });

  bot.onText(/^\/admin$/, async msg => {
    if (!isAdmin(msg)) {
      return bot.sendMessage(msg.chat.id, '⛔ Admin only.');
    }

    return bot.sendMessage(
      msg.chat.id,
      '🛠️ *BOSS X PRIME ADMIN PANEL*\n\nChoose a plan to generate a password.',
      { ...adminMenu, parse_mode: 'Markdown' }
    );
  });

  bot.on('callback_query', async q => {
    try {
      const [action, raw] = String(q.data || '').split(':');
      const days = Number(raw);

      if (action === 'buy' && [1, 180, 0].includes(days)) {
        const label = planLabel(days);

        if (ADMIN_TELEGRAM_ID) {
          await bot.sendMessage(
            ADMIN_TELEGRAM_ID,
            `🔔 *New purchase request*\n\nPlan: *${label}*\nCustomer: ${q.from.first_name || ''} ${q.from.last_name || ''}\nTelegram ID: \`${q.from.id}\`\nUsername: @${q.from.username || 'not set'}`,
            { parse_mode: 'Markdown' }
          );
        }

        await bot.answerCallbackQuery(q.id, {
          text: `${label} selected`
        });

        if (q.message) {
          await bot.sendMessage(
            q.message.chat.id,
            `✅ *${label} selected.*\n\nPlease contact the admin for payment and your password.`,
            { parse_mode: 'Markdown' }
          );
        }
        return;
      }

      if (action === 'gen' && [1, 180, 0].includes(days)) {
        // IMPORTANT: q.from is the user who clicked the button.
        if (!isAdmin(q.from)) {
          return bot.answerCallbackQuery(q.id, {
            text: 'Admin only',
            show_alert: true
          });
        }

        const license = await generateLicense(days);

        await bot.answerCallbackQuery(q.id, {
          text: 'Password generated'
        });

        return bot.sendMessage(
          q.message.chat.id,
          `🔐 *New ${planLabel(days)} Password*\n\n` +
          `\`${license.code}\`\n\n` +
          '⏱️ Validity starts when the customer activates it.\n' +
          '📱 Locked to the first device.',
          { parse_mode: 'Markdown' }
        );
      }

      if (action === 'list') {
        if (!isAdmin(q.from)) {
          return bot.answerCallbackQuery(q.id, {
            text: 'Admin only',
            show_alert: true
          });
        }

        const licenses = await listLicenses();
        const listText = licenses.length
          ? licenses.slice(0, 20).map(item =>
              `• \`${item.code}\` — ${planLabel(item.duration_days)} — ` +
              `${item.revoked_at ? 'Revoked' : item.activated_at ? 'Active' : 'Unused'}`
            ).join('\n')
          : 'No passwords yet.';

        await bot.answerCallbackQuery(q.id);

        return bot.sendMessage(
          q.message.chat.id,
          `📋 *Latest passwords*\n\n${listText}`,
          { parse_mode: 'Markdown' }
        );
      }

      await bot.answerCallbackQuery(q.id, {
        text: 'Unknown action',
        show_alert: true
      });
    } catch (error) {
      console.error('Telegram callback error:', error);
      try {
        await bot.answerCallbackQuery(q.id, {
          text: 'Something went wrong',
          show_alert: true
        });
      } catch {}
    }
  });

  console.log('Telegram premium bot started');
}

app.get('/api/config', (req, res) => {
  res.json({
    name: 'BOSS X PRIME',
    extensionName: 'BOSS Premium Mic',
    activationRequired: true
  });
});

app.post('/api/activate', async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const deviceId = String(req.body.deviceId || '').trim().slice(0, 120);

    if (!code) {
      return res.status(400).json({ error: 'Enter your password' });
    }

    if (!deviceId) {
      return res.status(400).json({
        error: 'This device could not be identified. Please enable browser storage and try again.'
      });
    }

    const fixed = code === String(FIXED_PASSWORDS.oneDay).trim().toUpperCase() && FIXED_PASSWORDS.oneDay
      ? { duration_days: 1 }
      : code === String(FIXED_PASSWORDS.sixMonths).trim().toUpperCase() && FIXED_PASSWORDS.sixMonths
        ? { duration_days: 180 }
        : code === String(FIXED_PASSWORDS.unlimited).trim().toUpperCase() && FIXED_PASSWORDS.unlimited
          ? { duration_days: 0 }
          : null;

    let license = await getLicense(code);
    const isNewFixed = !license && Boolean(fixed);

    if (isNewFixed) {
      license = {
        code,
        duration_days: fixed.duration_days,
        created_at: new Date().toISOString(),
        activated_at: null,
        expires_at: null,
        revoked_at: null,
        device_id: null
      };
    }

    if (!license) {
      return res.status(404).json({ error: 'Invalid password' });
    }

    if (license.revoked_at) {
      return res.status(403).json({ error: 'This password has been revoked' });
    }

    const now = new Date();

    if (license.expires_at && new Date(license.expires_at) <= now) {
      return res.status(403).json({ error: 'This password has expired' });
    }

    if (!license.activated_at) {
      license.activated_at = now.toISOString();
      license.expires_at = license.duration_days === 0
        ? null
        : new Date(now.getTime() + license.duration_days * 86400000).toISOString();
      license.device_id = deviceId;

      if (isNewFixed) {
        await saveLicense(license);
      } else {
        await updateLicense(license);
      }
    } else if (license.device_id && license.device_id !== deviceId) {
      return res.status(403).json({
        error: 'This password is already activated on another device'
      });
    }

    return res.json({
      ok: true,
      expiresAt: license.expires_at,
      plan: planLabel(license.duration_days)
    });
  } catch (error) {
    console.error('Activation error:', error);
    return res.status(500).json({ error: 'Activation service error' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const user = String(req.body.username || '');
  const pass = String(req.body.password || '');

  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const payload = {
    u: user,
    exp: Date.now() + 12 * 60 * 60 * 1000
  };

  res.setHeader(
    'Set-Cookie',
    `boss_admin=${encodeURIComponent(cookieValue(payload))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`
  );

  return res.json({ ok: true });
});

app.post('/api/admin/logout', adminRequired, (req, res) => {
  res.setHeader(
    'Set-Cookie',
    'boss_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  );
  res.json({ ok: true });
});

app.get('/api/admin/licenses', adminRequired, async (req, res) => {
  try {
    res.json(await listLicenses());
  } catch (error) {
    console.error('List licenses error:', error);
    res.status(500).json({ error: 'Could not load licenses' });
  }
});

app.post('/api/admin/licenses', adminRequired, async (req, res) => {
  try {
    const duration = Number(req.body.durationDays);

    if (![1, 180, 0].includes(duration)) {
      return res.status(400).json({
        error: 'Duration must be 1, 180 or 0 (Unlimited)'
      });
    }

    const license = await generateLicense(duration);
    res.json(license);
  } catch (error) {
    console.error('Create license error:', error);
    res.status(500).json({ error: 'Could not create license' });
  }
});

app.post('/api/admin/licenses/:code/revoke', adminRequired, async (req, res) => {
  try {
    const license = await getLicense(req.params.code);

    if (!license) {
      return res.status(404).json({ error: 'Not found' });
    }

    license.revoked_at = new Date().toISOString();
    await updateLicense(license);
    res.json({ ok: true });
  } catch (error) {
    console.error('Revoke license error:', error);
    res.status(500).json({ error: 'Could not revoke license' });
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb()
  .then(() => {
    startTelegramBot();
    app.listen(PORT, () => {
      console.log(`BOSS X PRIME site running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Startup error:', error);
    process.exit(1);
  });
