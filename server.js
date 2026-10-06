import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';

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
  const tag = days === 1 ? '1D' : days === 90 ? '3M' : '6M';
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
  if (!raw || !sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(401).json({ error: 'Invalid admin session' });
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

app.get('/api/config', (req,res)=>res.json({ name:'Quetta', extensionName:'BOSS Premium Mic', activationRequired:true }));
app.post('/api/activate', async (req,res)=>{
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const deviceId = String(req.body.deviceId || '').trim().slice(0,120);
    if (!code) return res.status(400).json({error:'Enter your password'});
    const l = await getLicense(code);
    if (!l) return res.status(404).json({error:'Invalid password'});
    if (l.revoked_at) return res.status(403).json({error:'This password has been revoked'});
    const now = new Date();
    if (l.expires_at && new Date(l.expires_at) <= now) return res.status(403).json({error:'This password has expired'});
    if (!l.activated_at) {
      l.activated_at = now.toISOString();
      l.expires_at = new Date(now.getTime() + l.duration_days*86400000).toISOString();
      l.device_id = deviceId || null;
      await updateLicense(l);
    } else if (l.device_id && deviceId && l.device_id !== deviceId) {
      return res.status(403).json({error:'This password is already activated on another device'});
    }
    res.json({ok:true, expiresAt:l.expires_at, plan:l.duration_days===1?'1 Day':l.duration_days===90?'3 Months':'6 Months'});
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
  if (![1,90,180].includes(duration)) return res.status(400).json({error:'Duration must be 1, 90 or 180 days'});
  let code=makeCode(duration); while(await getLicense(code)) code=makeCode(duration);
  const l={code,duration_days:duration,created_at:new Date().toISOString(),activated_at:null,expires_at:null,revoked_at:null,device_id:null};
  await saveLicense(l); res.json(l);
});
app.post('/api/admin/licenses/:code/revoke',adminRequired,async(req,res)=>{ const l=await getLicense(req.params.code); if(!l)return res.status(404).json({error:'Not found'}); l.revoked_at=new Date().toISOString(); await updateLicense(l); res.json({ok:true}); });
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

initDb().then(()=>app.listen(PORT,()=>console.log(`Quetta BOSS site running on ${PORT}`))).catch(err=>{console.error(err);process.exit(1)});
