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
// Add your own activation passwords here if you want fixed passwords in the file.
// Leave blank to use passwords generated from the Admin panel.
const FIXED_PASSWORDS = {
  oneDay: process.env.BOSS_1D_PASSWORD || '',
  sixMonths: process.env.BOSS_6M_PASSWORD || '',
  unlimited: process.env.BOSS_UNLIMITED_PASSWORD || ''
};

const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const memory = { licenses: new Map(), sessions: new Map() };

async function initDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    duration_days INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    device_id TEXT
  )`);
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function makeCode(days) {
  const tag = days === 1 ? '1D' : days === 180 ? '6M' : 'UNL';
  const body = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `BOSS-${tag}-${body}`;
}
function cookieValue(payload) {
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}
function readCookie(req, name) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => { const i=v.indexOf('='); return [v.slice(0,i).trim(), decodeURIComponent(v.slice(i+1))]; }));
  return cookies[name];
}
function adminRequired(req, res, next) {
  const token = readCookie(req, 'boss_admin');
  if (!token) return res.status(401).json({ error: 'Admin login required' });
  const [raw, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(raw || '').digest('base64url');
  if (!raw || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(401).json({ error: 'Invalid admin session' });
  try { const data = JSON.parse(Buffer.from(raw, 'base64url').toString()); if (data.exp < Date.now()) throw new Error(); } catch { return res.status(401).json({ error: 'Admin session expired' }); }
  next();
}
async function getLicense(code) {
  if (pool) { const r = await pool.query('SELECT * FROM licenses WHERE code=$1', [code]); return r.rows[0] || null; }
  return memory.licenses.get(code) || null;
}
async function saveLicense(l) {
  if (pool) {
    await pool.query(`INSERT INTO licenses(code,duration_days,created_at,activated_at,expires_at,revoked_at,device_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [l.code,l.duration_days,l.created_at,l.activated_at,l.expires_at,l.revoked_at,l.device_id]);
  } else memory.licenses.set(l.code, l);
}
async function updateLicense(l) {
  if (pool) await pool.query(`UPDATE licenses SET activated_at=$1, expires_at=$2, revoked_at=$3, device_id=$4 WHERE code=$5`, [l.activated_at,l.expires_at,l.revoked_at,l.device_id,l.code]);
  else memory.licenses.set(l.code, l);
}
async function listLicenses() {
  if (pool) { const r=await pool.query('SELECT * FROM licenses ORDER BY id DESC'); return r.rows; }
  return [...memory.licenses.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at));
}


async function generateLicense(duration) {
  let code=makeCode(duration); while(await getLicense(code)) code=makeCode(duration);
  const l={code,duration_days:duration,created_at:new Date().toISOString(),activated_at:null,expires_at:null,revoked_at:null,device_id:null};
  await saveLicense(l); return l;
}

function planLabel(days) { return days===0?'Unlimited':days===1?'1 Day':'6 Months'; }

function startTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN) return;
  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  const isAdmin = msg => ADMIN_TELEGRAM_ID && String(msg.from?.id) === ADMIN_TELEGRAM_ID;
  const customerMenu = {
    reply_markup: { inline_keyboard: [
      [{text:'💎 1 Day', callback_data:'buy:1'}, {text:'💎 6 Months', callback_data:'buy:180'}],
      [{text:'♾️ Unlimited', callback_data:'buy:0'}]
    ]}
  };
  const adminMenu = {
    reply_markup: { inline_keyboard: [
      [{text:'🔑 Generate 1 Day', callback_data:'gen:1'}],
      [{text:'🔑 Generate 6 Months', callback_data:'gen:180'}],
      [{text:'🔑 Generate Unlimited', callback_data:'gen:0'}],
      [{text:'📋 Password List', callback_data:'list:all'}]
    ]}
  };
  bot.onText(/^\/start$/, msg => bot.sendMessage(msg.chat.id,
    `👑 *BOSS X PRIME*\n\nChoose the plan you want. After payment, the admin will give you a unique password.`,
    {...customerMenu, parse_mode:'Markdown'}));
  bot.onText(/^\/admin$/, msg => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id,'⛔ Admin only.');
    bot.sendMessage(msg.chat.id,'🛠️ *BOSS X PRIME ADMIN PANEL*\n\nChoose a plan to generate a unique customer password.', {...adminMenu, parse_mode:'Markdown'});
  });
  bot.on('callback_query', async q => {
    try {
      const [action, raw] = String(q.data||'').split(':');
      const days = Number(raw);
      if (action==='buy' && [1,180,0].includes(days)) {
        const label=planLabel(days);
        if (ADMIN_TELEGRAM_ID) await bot.sendMessage(ADMIN_TELEGRAM_ID, `🔔 *New purchase request*\n\nPlan: *${label}*\nCustomer: ${q.from.first_name||''} ${q.from.last_name||''}\nTelegram ID: \`${q.from.id}\`\nUsername: @${q.from.username||'not set'}`, {parse_mode:'Markdown'});
        await bot.answerCallbackQuery(q.id, {text:`${label} selected`});
        return bot.sendMessage(q.message.chat.id, `✅ *${label} selected.*\n\nPlease contact the admin for payment and your password.`, {parse_mode:'Markdown'});
      }
      if (action==='gen' && [1,180,0].includes(days)) {
        ```js
if (!isAdmin({ from: q.from })) return bot.answerCallbackQuery(q.id,{text:'Admin only',show_alert:true});
```
        
        const l=await generateLicense(days);
        await bot.answerCallbackQuery(q.id,{text:'Password generated'});
        return bot.sendMessage(q.message.chat.id, `🔐 *New ${planLabel(days)} Password*\n\n\`${l.code}\`\n\n⏱️ Validity starts when the customer activates it.\n📱 Locked to the first device.`, {parse_mode:'Markdown'});
      }
      if (action==='list') {
        if (!isAdmin({ from: q.from })) return bot.answerCallbackQuery(q.id,{text:'Bossx Admin only',show_alert:true});
        const list=await listLicenses();
        const text=list.length ? list.slice(0,20).map(x=>`• \`${x.code}\` — ${planLabel(x.duration_days)} — ${x.activated_at?'Active':'Unused'}${x.revoked_at?' — Revoked':''}`).join('\n') : 'No passwords yet.';
        return bot.sendMessage(q.message.chat.id, `📋 *Latest passwords*\n\n${text}`, {parse_mode:'Markdown'});
      }
    } catch(e) { console.error('Telegram callback error',e); }
  });
  console.log('Telegram premium bot started');
}

app.get('/api/config', (req,res)=>res.json({ name:'Quetta', extensionName:'BOSS Premium Mic', activationRequired:true }));
app.post('/api/activate', async (req,res)=>{
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const deviceId = String(req.body.deviceId || '').trim().slice(0,120);
    if (!code) return res.status(400).json({error:'Enter your password'});
    if (!deviceId) return res.status(400).json({error:'This device could not be identified. Please enable browser storage and try again.'});
    // Fixed passwords are optional; when supplied, they behave like normal licenses.
    const fixed = code === String(FIXED_PASSWORDS.oneDay || '').trim().toUpperCase() ? {duration_days:1} :
      code === String(FIXED_PASSWORDS.sixMonths || '').trim().toUpperCase() ? {duration_days:180} :
      code === String(FIXED_PASSWORDS.unlimited || '').trim().toUpperCase() ? {duration_days:0} : null;
    let l = await getLicense(code);
    const isNewFixed = !l && !!fixed;
    if (isNewFixed) l = {code,duration_days:fixed.duration_days,created_at:new Date().toISOString(),activated_at:null,expires_at:null,revoked_at:null,device_id:null};
    if (!l) return res.status(404).json({error:'Invalid password'});
    if (l.revoked_at) return res.status(403).json({error:'This password has been revoked'});
    const now = new Date();
    if (l.expires_at && new Date(l.expires_at) <= now) return res.status(403).json({error:'This password has expired'});
    if (!l.activated_at) {
      l.activated_at = now.toISOString();
      l.expires_at = l.duration_days===0 ? null : new Date(now.getTime() + l.duration_days*86400000).toISOString();
      l.device_id = deviceId || null;
      if (isNewFixed) await saveLicense(l); else await updateLicense(l);
    } else if (l.device_id && deviceId && l.device_id !== deviceId) {
      return res.status(403).json({error:'This password is already activated on another device'});
    }
    res.json({ok:true, expiresAt:l.expires_at, plan:l.duration_days===0?'Unlimited':l.duration_days===1?'1 Day':'6 Months'});
  } catch(e) { res.status(500).json({error:'Activation service error'}); }
});

app.post('/api/admin/login',(req,res)=>{
  const user=String(req.body.username||''); const pass=String(req.body.password||'');
  if (user!==ADMIN_USER || pass!==ADMIN_PASSWORD) return res.status(401).json({error:'Invalid admin credentials'});
  const raw={u:user,exp:Date.now()+12*60*60*1000};
  res.setHeader('Set-Cookie',`boss_admin=${encodeURIComponent(cookieValue(raw))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`);
  res.json({ok:true});
});
app.post('/api/admin/logout',adminRequired,(req,res)=>{ res.setHeader('Set-Cookie','boss_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'); res.json({ok:true}); });
app.get('/api/admin/licenses',adminRequired,async(req,res)=>res.json(await listLicenses()));
app.post('/api/admin/licenses',adminRequired,async(req,res)=>{
  const duration=Number(req.body.durationDays);
  if (![1,180,0].includes(duration)) return res.status(400).json({error:'Duration must be 1, 180 or 0 (Unlimited)'});
  const l=await generateLicense(duration); res.json(l);
});
app.post('/api/admin/licenses/:code/revoke',adminRequired,async(req,res)=>{ const l=await getLicense(req.params.code); if(!l)return res.status(404).json({error:'Not found'}); l.revoked_at=new Date().toISOString(); await updateLicense(l); res.json({ok:true}); });
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

initDb().then(()=>{ startTelegramBot(); app.listen(PORT,()=>console.log(`Quetta BOSS site running on ${PORT}`)); }).catch(err=>{console.error(err);process.exit(1)});
    
