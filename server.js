import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import TelegramBot from "node-telegram-bot-api";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMIN_IDS = [
  process.env.ADMIN_TELEGRAM_ID,
  process.env.TELEGRAM_CHAT_ID,
  process.env.TELEGRAM_CHAT_IDS
].flatMap(value => String(value || "").split(","))
  .map(s => s.trim())
  .filter(Boolean);
const BUY_URL = "https://t.me/BOSSX929";
const DATABASE_URL = process.env.DATABASE_URL || "";

const PLANS = {
  "1D": { label: "1 Day", days: 1 },
  "3M": { label: "3 Months", days: 90 },
  "6M": { label: "6 Months", days: 183 },
  "UNLIMITED": { label: "Unlimited", days: null }
};

let pool = null;
let useDb = false;
const memory = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// The browser extension package is intentionally not downloadable.
app.get("/BOSS-Premium-Mic.zip", (_req, res) => {
  res.status(404).send("Not found");
});

app.use(express.static(path.join(__dirname, "public")));

function randomToken(n = 8) {
  return crypto.randomBytes(n).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, n * 2);
}
function makeCode() {
  return `BXP-${randomToken(6).toUpperCase()}`;
}
function makePassword() {
  return randomToken(7);
}
function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
function sessionToken() {
  const payload = `${ADMIN_USER}:${Date.now()}:${randomToken(12)}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + sig;
}
function adminSession(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(/(?:^|;\s*)bxp_admin=([^;]+)/);
  if (!m) return false;
  try {
    const token = decodeURIComponent(m[1]);
    const [encoded, sig] = token.split(".");
    if (!encoded || !sig) return false;
    const payload = Buffer.from(encoded, "base64url").toString();
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}
function requireAdmin(req, res, next) {
  if (!adminSession(req)) return res.status(401).json({ ok:false, error:"Unauthorized" });
  next();
}
function expiresFor(plan) {
  const days = PLANS[plan]?.days;
  return days == null ? null : new Date(Date.now() + days * 86400000);
}

async function initDb() {
  if (!DATABASE_URL) return console.log("DATABASE_URL not set; using memory storage.");
  try {
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized:false } });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unused',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        activated_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        device_id_hash TEXT,
        activated_by TEXT
      )
    `);
    useDb = true;
    console.log("PostgreSQL ready.");
  } catch (e) {
    console.error("PostgreSQL unavailable; using memory storage:", e.message);
    pool = null; useDb = false;
  }
}

async function createLicense(plan) {
  if (!PLANS[plan]) throw new Error("Invalid plan");
  const code = makeCode();
  const password = makePassword();
  const expires = expiresFor(plan);
  if (useDb) {
    const r = await pool.query(
      `INSERT INTO licenses(code,password_hash,plan,expires_at) VALUES($1,$2,$3,$4) RETURNING id,code,plan,status,created_at,expires_at`,
      [code, hash(password), plan, expires]
    );
    return { ...r.rows[0], password };
  }
  const row = { id: memory.size+1, code, password_hash:hash(password), plan, status:"unused", created_at:new Date(), activated_at:null, expires_at:expires, device_id_hash:null, activated_by:null };
  memory.set(code, row);
  return { ...row, password };
}

async function findLicense(code) {
  if (useDb) {
    const r = await pool.query("SELECT * FROM licenses WHERE code=$1 LIMIT 1", [code]);
    return r.rows[0] || null;
  }
  return memory.get(code) || null;
}

async function activate(code, password, deviceId, activatedBy) {
  const lic = await findLicense(code);
  if (!lic) return { ok:false, error:"License not found." };
  if (lic.expires_at && new Date(lic.expires_at) <= new Date()) return { ok:false, error:"License expired." };
  if (lic.status === "activated" && lic.device_id_hash !== hash(deviceId)) return { ok:false, error:"This license is already bound to another device." };
  if (hash(password) !== lic.password_hash) return { ok:false, error:"Wrong password." };

  const activatedAt = lic.activated_at || new Date();
  const expires = lic.expires_at || expiresFor(lic.plan);
  if (useDb) {
    const r = await pool.query(
      `UPDATE licenses SET status='activated',activated_at=$1,expires_at=$2,device_id_hash=$3,activated_by=$4 WHERE code=$5 RETURNING *`,
      [activatedAt, expires, hash(deviceId), activatedBy || "", code]
    );
    return { ok:true, license:r.rows[0] };
  }
  lic.status="activated"; lic.activated_at=activatedAt; lic.expires_at=expires; lic.device_id_hash=hash(deviceId); lic.activated_by=activatedBy || "";
  return { ok:true, license:lic };
}

async function listLicenses() {
  if (useDb) {
    const r = await pool.query("SELECT id,code,plan,status,created_at,activated_at,expires_at,activated_by FROM licenses ORDER BY id DESC LIMIT 500");
    return r.rows;
  }
  return [...memory.values()].sort((a,b)=>b.id-a.id).map(({password_hash,device_id_hash,...x})=>x);
}

function planName(plan) { return PLANS[plan]?.label || plan; }

let bot = null;
function isAdminMessage(msg) { return ADMIN_IDS.includes(String(msg?.from?.id || "")); }

async function startBot() {
  if (!BOT_TOKEN) return console.log("TELEGRAM_BOT_TOKEN not set; bot disabled.");
  bot = new TelegramBot(BOT_TOKEN, { polling:{ autoStart:false } });
  bot.on("polling_error", e => console.error("Telegram polling error:", e.message));
  bot.onText(/^\/start$/, async msg => {
    await bot.sendMessage(msg.chat.id, "👑 BOSS X PRIME\n\nBuy a license or open the web panel.", {
      reply_markup:{ inline_keyboard:[
        [{text:"🛒 BUY / CONTACT", url:BUY_URL}],
        [{text:"🌐 OPEN WEBSITE", url:process.env.PUBLIC_URL || "https://t.me/BOSSX929"}]
      ]}
    });
  });
  bot.onText(/^\/id$/, msg => bot.sendMessage(msg.chat.id, `Your Telegram ID: ${msg.from?.id || "unknown"}`));
  for (const [cmd, plan] of [["gen1","1D"],["gen3m","3M"],["gen6m","6M"],["genunlimited","UNLIMITED"]]) {
    bot.onText(new RegExp(`^\\/${cmd}$`), async msg => {
      if (!isAdminMessage(msg)) return bot.sendMessage(msg.chat.id, "❌ Admin access denied.");
      try {
        const x = await createLicense(plan);
        await bot.sendMessage(msg.chat.id, `✅ ${planName(plan)} LICENSE\\n\\nCode: ${x.code}\\nPassword: ${x.password}\\n\\n⚠️ Keep this password private.\\nDevice: one activation only.`);
      } catch (e) { await bot.sendMessage(msg.chat.id, "❌ Generation failed."); }
    });
  }
  bot.onText(/^\/list$/, async msg => {
    if (!isAdminMessage(msg)) return bot.sendMessage(msg.chat.id, "❌ Admin access denied.");
    const rows = await listLicenses();
    if (!rows.length) return bot.sendMessage(msg.chat.id, "No licenses yet.");
    const text = rows.slice(0,20).map((x,i)=>`${i+1}. ${planName(x.plan)} | ${x.code} | ${x.status}`).join("\n");
    await bot.sendMessage(msg.chat.id, "📋 LICENSES\n\n"+text);
  });
  try { await bot.startPolling(); console.log("Telegram polling started."); }
  catch(e) { console.error("Telegram polling start failed:", e.message); }
}

app.get("/api/health", (_req,res)=>res.json({ok:true, service:"BOSS X PRIME", database:useDb?"postgresql":"memory"}));
app.get("/api/config", (_req,res)=>res.json({ok:true, name:"BOSS X PRIME", buyUrl:BUY_URL, plans:Object.entries(PLANS).map(([id,p])=>({id,name:p.label}))}));

app.post("/api/activate", async (req,res)=>{
  try {
    const code=String(req.body?.code||"").trim().toUpperCase();
    const password=String(req.body?.password||"").trim();
    const deviceId=String(req.body?.deviceId||"").trim();
    if (!code || !password || !deviceId) return res.status(400).json({ok:false,error:"Code, password and device ID are required."});
    const result=await activate(code,password,deviceId,String(req.body?.activatedBy||""));
    if (!result.ok) return res.status(400).json(result);
    return res.json({ok:true,plan:result.license.plan,planName:planName(result.license.plan),expiresAt:result.license.expires_at});
  } catch(e) { console.error(e); res.status(500).json({ok:false,error:"Server error."}); }
});

app.post("/api/admin/login",(req,res)=>{
  if (String(req.body?.username||"")!==ADMIN_USER || String(req.body?.password||"")!==ADMIN_PASSWORD || !ADMIN_PASSWORD)
    return res.status(401).json({ok:false,error:"Invalid credentials."});
  res.setHeader("Set-Cookie",`bxp_admin=${encodeURIComponent(sessionToken())}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);
  res.json({ok:true});
});
app.post("/api/admin/logout",(_req,res)=>{res.setHeader("Set-Cookie","bxp_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");res.json({ok:true});});
app.get("/api/admin/licenses",requireAdmin,async(_req,res)=>res.json({ok:true,licenses:await listLicenses()}));
app.post("/api/admin/licenses",requireAdmin,async(req,res)=>{try{const x=await createLicense(String(req.body?.plan||"").toUpperCase());res.json({ok:true,license:x});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.get("*",(req,res)=>{
  if (req.path.startsWith("/api/")) return res.status(404).json({ok:false,error:"Not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});

async function start() {
  await initDb();
  app.listen(PORT,"0.0.0.0",()=>console.log(`BOSS X PRIME running on ${PORT}`));
  await startBot();
}
start().catch(e=>{console.error("Startup error:",e);process.exit(1);});
