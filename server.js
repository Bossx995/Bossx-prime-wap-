import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import TelegramBot from 'node-telegram-bot-api';

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

const PORT =
  process.env.PORT || 3000;

/* ==================================================
   ENV
================================================== */

const ADMIN_USER =
  process.env.ADMIN_USER || '';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || '';

const SESSION_SECRET =
  process.env.SESSION_SECRET || '';

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '';

/* ==================================================
   TELEGRAM ADMINS
================================================== */

const ADMIN_TELEGRAM_IDS = String(
  process.env.ADMIN_TELEGRAM_ID || ''
)
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

/*
  Compatibility variable
*/

const ADMIN_TELEGRAM_ID =
  ADMIN_TELEGRAM_IDS[0] || '';

/* ==================================================
   FIXED PASSWORDS
================================================== */

const FIXED_PASSWORDS = {
  oneDay:
    process.env.BOSS_1D_PASSWORD || '',

  sixMonths:
    process.env.BOSS_6M_PASSWORD || '',

  unlimited:
    process.env.BOSS_UNLIMITED_PASSWORD || ''
};

/* ==================================================
   DATABASE
================================================== */

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString:
        process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    })
  : null;

const memory = {
  licenses: new Map()
};

/* ==================================================
   DATABASE INIT
================================================== */

async function initDb() {
  if (!pool) {
    console.log(
      'DATABASE_URL not found. Using memory storage.'
    );

    return;
  }

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

  console.log(
    'Database initialized'
  );
}

/* ==================================================
   LICENSE HELPERS
================================================== */

function makeCode(days) {
  const tag =
    days === 1
      ? '1D'
      : days === 180
      ? '6M'
      : 'UNL';

  return `BOSS-${tag}-${crypto
    .randomBytes(8)
    .toString('hex')
    .toUpperCase()}`;
}

function planLabel(days) {
  if (days === 0) {
    return 'Unlimited';
  }

  if (days === 1) {
    return '1 Day';
  }

  return '6 Months';
}

/* ==================================================
   SESSION
================================================== */

function cookieValue(payload) {
  const raw = Buffer
    .from(
      JSON.stringify(payload)
    )
    .toString('base64url');

  const sig = crypto
    .createHmac(
      'sha256',
      SESSION_SECRET
    )
    .update(raw)
    .digest('base64url');

  return `${raw}.${sig}`;
}

function readCookie(req, name) {
  const cookies =
    Object.fromEntries(
      (req.headers.cookie || '')
        .split(';')
        .filter(Boolean)
        .map(v => {
          const i =
            v.indexOf('=');

          return [
            v.slice(0, i).trim(),
            decodeURIComponent(
              v.slice(i + 1)
            )
          ];
        })
    );

  return cookies[name];
}

/* ==================================================
   WEB ADMIN AUTH
================================================== */

function adminRequired(
  req,
  res,
  next
) {
  const token =
    readCookie(
      req,
      'boss_admin'
    );

  if (!token) {
    return res
      .status(401)
      .json({
        error:
          'Admin login required'
      });
  }

  const [
    raw,
    sig
  ] = String(token).split('.');

  if (!raw || !sig) {
    return res
      .status(401)
      .json({
        error:
          'Invalid admin session'
      });
  }

  const expected =
    crypto
      .createHmac(
        'sha256',
        SESSION_SECRET
      )
      .update(raw)
      .digest('base64url');

  const actualBuffer =
    Buffer.from(sig);

  const expectedBuffer =
    Buffer.from(expected);

  if (
    actualBuffer.length !==
      expectedBuffer.length ||
    !crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer
    )
  ) {
    return res
      .status(401)
      .json({
        error:
          'Invalid admin session'
      });
  }

  try {
    const data =
      JSON.parse(
        Buffer
          .from(
            raw,
            'base64url'
          )
          .toString()
      );

    if (
      data.exp < Date.now() ||
      data.u !== ADMIN_USER
    ) {
      throw new Error(
        'Expired or invalid session'
      );
    }
  } catch {
    return res
      .status(401)
      .json({
        error:
          'Admin session expired'
      });
  }

  next();
}

/* ==================================================
   LICENSE DATABASE
================================================== */

async function getLicense(code) {
  if (pool) {
    const result =
      await pool.query(
        'SELECT * FROM licenses WHERE code=$1',
        [code]
      );

    return (
      result.rows[0] || null
    );
  }

  return (
    memory.licenses.get(code) ||
    null
  );
}

async function saveLicense(
  license
) {
  if (pool) {
    await pool.query(
      `
      INSERT INTO licenses (
        code,
        duration_days,
        created_at,
        activated_at,
        expires_at,
        revoked_at,
        device_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7
      )
      `,
      [
        license.code,
        license.duration_days,
        license.created_at,
        license.activated_at,
        license.expires_at,
        license.revoked_at,
        license.device_id
      ]
    );

    return;
  }

  memory.licenses.set(
    license.code,
    license
  );
}

async function updateLicense(
  license
) {
  if (pool) {
    await pool.query(
      `
      UPDATE licenses
      SET
        activated_at=$1,
        expires_at=$2,
        revoked_at=$3,
        device_id=$4
      WHERE code=$5
      `,
      [
        license.activated_at,
        license.expires_at,
        license.revoked_at,
        license.device_id,
        license.code
      ]
    );

    return;
  }

  memory.licenses.set(
    license.code,
    license
  );
}

async function listLicenses() {
  if (pool) {
    const result =
      await pool.query(
        'SELECT * FROM licenses ORDER BY id DESC'
      );

    return result.rows;
  }

  return [
    ...memory.licenses.values()
  ].sort(
    (a, b) =>
      new Date(b.created_at) -
      new Date(a.created_at)
  );
}

async function generateLicense(
  duration
) {
  let code;

  do {
    code =
      makeCode(duration);
  } while (
    await getLicense(code)
  );

  const license = {
    code,
    duration_days: duration,
    created_at:
      new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    revoked_at: null,
    device_id: null
  };

  await saveLicense(
    license
  );

  return license;
}

/* ==================================================
   TELEGRAM BOT
================================================== */

function startTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(
      'Telegram bot disabled: missing bot token'
    );

    return;
  }

  const bot =
    new TelegramBot(
      TELEGRAM_BOT_TOKEN,
      {
        polling: true
      }
    );

  /* ==================================================
     POLLING ERROR
  ================================================== */

  bot.on(
    'polling_error',
    error => {
      console.error(
        'Telegram polling error:',
        error?.message ||
          error
      );
    }
  );

  /* ==================================================
     ADMIN CHECK
  ================================================== */

  const isAdmin = user => {
    const id =
      String(
        user?.from?.id ??
        user?.id ??
        ''
      ).trim();

    return (
      Boolean(id) &&
      ADMIN_TELEGRAM_IDS.includes(
        id
      )
    );
  };

  /* ==================================================
     CUSTOMER MENU
  ================================================== */

  const customerMenu = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '💎 1 Day',
            callback_data:
              'buy:1'
          },
          {
            text: '💎 6 Months',
            callback_data:
              'buy:180'
          }
        ],
        [
          {
            text: '♾️ Unlimited',
            callback_data:
              'buy:0'
          }
        ]
      ]
    }
  };

  /* ==================================================
     ADMIN MENU
  ================================================== */

  const adminMenu = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text:
              '🔑 Generate 1 Day',
            callback_data:
              'gen:1'
          }
        ],
        [
          {
            text:
              '🔑 Generate 6 Months',
            callback_data:
              'gen:180'
          }
        ],
        [
          {
            text:
              '🔑 Generate Unlimited',
            callback_data:
              'gen:0'
          }
        ],
        [
          {
            text:
              '📋 Password List',
            callback_data:
              'list:all'
          }
        ]
      ]
    }
  };

  /* ==================================================
     /start
  ================================================== */

  bot.onText(
    /^\/start$/,
    async msg => {
      try {
        await bot.sendMessage(
          msg.chat.id,
          `👑 BOSS X PRIME

Choose your plan.
Contact the admin for payment and your password.`,
          customerMenu
        );
      } catch (error) {
        console.error(
          'Start command error:',
          error
        );
      }
    }
  );

  /* ==================================================
     /plans
  ================================================== */

  bot.onText(
    /^\/plans$/,
    async msg => {
      try {
        await bot.sendMessage(
          msg.chat.id,
          `💎 BOSS X PRIME

Choose your plan:`,
          customerMenu
        );
      } catch (error) {
        console.error(
          'Plans command error:',
          error
        );
      }
    }
  );

  /* ==================================================
     /id
  ================================================== */

  bot.onText(
    /^\/id$/,
    async msg => {
      try {
        const id =
          String(
            msg?.from?.id || ''
          );

        await bot.sendMessage(
          msg.chat.id,
          `🆔 Your Telegram ID:

${id}`
        );
      } catch (error) {
        console.error(
          'ID command error:',
          error
        );
      }
    }
  );

  /* ==================================================
     /help
  ================================================== */

  bot.onText(
    /^\/help$/,
    async msg => {
      try {
        if (isAdmin(msg)) {
          return bot.sendMessage(
            msg.chat.id,
            `🛠️ BOSS X PRIME ADMIN

Commands:

/admin
/gen1
/gen6m
/genunlimited
/list
/id
/help`
          );
        }

        return bot.sendMessage(
          msg.chat.id,
          `👑 BOSS X PRIME

Commands:

/start
/plans
/id
/help

Choose a plan and contact admin for payment.`
        );
      } catch (error) {
        console.error(
          'Help command error:',
          error
        );
      }
    }
  );

  /* ==================================================
     /admin
  ================================================== */

  bot.onText(
    /^\/admin$/,
    async msg => {
      try {
        if (!isAdmin(msg)) {
          const id =
            String(
              msg?.from?.id || ''
            ).trim();

          return bot.sendMessage(
            msg.chat.id,
            `⛔ Admin only.

Your Telegram ID:
${id}

Add this ID to Railway variable:
ADMIN_TELEGRAM_ID`
          );
        }

        return bot.sendMessage(
          msg.chat.id,
          `🛠️ BOSS X PRIME ADMIN PANEL

Choose an option:`,
          adminMenu
        );
      } catch (error) {
        console.error(
          'Admin command error:',
          error
        );
      }
    }
  );

  /* ==================================================
     /gen1
  ================================================== */

  bot.onText(
    /^\/gen1$/,
    async msg => {
      try {
        if (!isAdmin(msg)) {
          return bot.sendMessage(
            msg.chat.id,
            '⛔ Admin only.'
          );
        }

        const license =
          await generateLicense(1);

        return bot.sendMessage(
          msg.chat.id,
          `🔐 NEW 1 DAY PASSWORD

${license.code}

⏱️ Validity starts when customer activates it.
📱 Locked to first device.`
        );
      } catch (error) {
        console.error(
          'Generate 1 day error:',
          error
        );

        await bot.sendMessage(
          msg.chat.id,
          '❌ Could not generate password.'
        );
      }
    }
  );

  /* ==================================================
     /gen6m
  ================================================== */

  bot.onText(
    /^\/gen6m$/,
    async msg => {
      try {
        if (!isAdmin(msg)) {
          return bot.sendMessage(
            msg.chat.id,
            '⛔ Admin only.'
          );
        }

        const license =
          await generateLicense(180);

        return bot.sendMessage(
          msg.chat.id,
          `🔐 NEW 6 MONTHS PASSWORD

${license.code}

⏱️ Validity starts when customer activates it.
📱 Locked to first device.`
        );
      } catch (error) {
        console.error(
          'Generate 6 months error:',
          error
        );

        await bot.sendMessage(
          msg.chat.id,
          '❌ Could not generate password.'
        );
      }
    }
  );

  /* ==================================================
     /genunlimited
  ================================================== */

  bot.onText(
    /^\/genunlimited$/,
    async msg => {
      try {
        if (!isAdmin(msg)) {
          return bot.sendMessage(
            msg.chat.id,
            '⛔ Admin only.'
          );
        }

        const license =
          await generateLicense(0);

        return bot.sendMessage(
          msg.chat.id,
          `🔐 NEW UNLIMITED PASSWORD

${license.code}

♾️ Unlimited validity.
📱 Locked to first device.`
        );
      } catch (error) {
        console.error(
          'Generate unlimited error:',
          error
        );

        await bot.sendMessage(
          msg.chat.id,
          '❌ Could not generate password.'
        );
      }
    }
  );

  /* ==================================================
     /list
  ================================================== */

  bot.onText(
    /^\/list$/,
    async msg => {
      try {
        if (!isAdmin(msg)) {
          return bot.sendMessage(
            msg.chat.id,
            '⛔ Admin only.'
          );
        }

        const licenses =
          await listLicenses();

        if (!licenses.length) {
          return bot.sendMessage(
            msg.chat.id,
            '📋 No passwords generated yet.'
          );
        }

        const listText =
          licenses
            .slice(0, 30)
            .map(
              (item, index) => {
                const status =
                  item.revoked_at
                    ? '❌ Revoked'
                    : item.activated_at
                    ? '✅ Active'
                    : '🟡 Unused';

                return `${index + 1}. ${item.code}
Plan: ${planLabel(
                  item.duration_days
                )}
Status: ${status}`;
              }
            )
            .join('\n\n');

        return bot.sendMessage(
          msg.chat.id,
          `📋 PASSWORD LIST

${listText}`
        );
      } catch (error) {
        console.error(
          'List command error:',
          error
        );

        await bot.sendMessage(
          msg.chat.id,
          '❌ Could not load password list.'
        );
      }
    }
  );

  /* ==================================================
     CALLBACK BUTTONS
  ================================================== */

  bot.on(
    'callback_query',
    async q => {
      try {
        const data =
          String(
            q.data || ''
          );

        const [
          action,
          raw
        ] = data.split(':');

        const days =
          Number(raw);

        /* ==================================================
           CUSTOMER PURCHASE
        ================================================== */

        if (
          action === 'buy' &&
          [1, 180, 0].includes(
            days
          )
        ) {
          const label =
            planLabel(days);

          const name =
            `${q.from?.first_name || ''} ${
              q.from?.last_name || ''
            }`.trim();

          const username =
            q.from?.username
              ? `@${q.from.username}`
              : 'not set';

          if (
            ADMIN_TELEGRAM_ID
          ) {
            await bot.sendMessage(
              ADMIN_TELEGRAM_ID,
              `🔔 NEW PURCHASE REQUEST

Plan: ${label}
Customer: ${name || 'Unknown'}
Telegram ID: ${q.from?.id || ''}
Username: ${username}`
            );
          }

          await bot.answerCallbackQuery(
            q.id,
            {
              text:
                `${label} selected`
            }
          );

          if (
            q.message?.chat?.id
          ) {
            await bot.sendMessage(
              q.message.chat.id,
              `✅ ${label} selected.

🔐 Please contact the admin for payment and password.`
            );
          }

          return;
        }

        /* ==================================================
           ADMIN GENERATE
        ================================================== */

        if (
          action === 'gen' &&
          [1, 180, 0].includes(
            days
          )
        ) {
          if (!isAdmin(q)) {
            await bot.answerCallbackQuery(
              q.id,
              {
                text:
                  '⛔ Admin only.',
                show_alert:
                  true
              }
            );

            return;
          }

          const license =
            await generateLicense(
              days
            );

          await bot.answerCallbackQuery(
            q.id,
            {
              text:
                'Password generated'
            }
          );

          if (
            !q.message?.chat?.id
          ) {
            return;
          }

          return bot.sendMessage(
            q.message.chat.id,
            `🔐 NEW ${planLabel(
              days
            ).toUpperCase()} PASSWORD

${license.code}

⏱️ Validity starts when customer activates it.
📱 Locked to first device.`
          );
        }

        /* ==================================================
           PASSWORD LIST
        ================================================== */

        if (
          action === 'list' &&
          raw === 'all'
        ) {
          if (!isAdmin(q)) {
            await bot.answerCallbackQuery(
              q.id,
              {
 
