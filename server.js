import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import Database from "better-sqlite3";

const app = express();
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const db = new Database("boss_x_prime.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT UNIQUE NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  plan TEXT NOT NULL DEFAULT 'day'
);
`);

try { db.exec("ALTER TABLE devices ADD COLUMN plan TEXT NOT NULL DEFAULT 'day'"); } catch {}

app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

const sessions = new Map();

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function randomCode() {
  return crypto.randomInt(100000, 1000000).toString();
}
function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("hex");
}
function makeSession(deviceId) {
  const raw = `${deviceId}.${Date.now()}.${crypto.randomBytes(18).toString("hex")}`;
  return `${raw}.${sign(raw)}`;
}
function validSession(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length < 4) return false;
  const sig = parts.pop();
  const raw = parts.join(".");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(raw)))) return false;
  } catch { return false; }
  return true;
}
function activeDeviceSession(req) {
  const token = req.cookies.device_session;
  if (!validSession(token) || !sessions.has(token) || sessions.get(token) === "admin") return null;
  const deviceId = sessions.get(token);
  const row = db.prepare("SELECT revoked, expires_at, plan FROM devices WHERE device_id=?").get(deviceId);
  if (!row || row.revoked || row.plan === "pending" || (row.expires_at !== 0 && row.expires_at <= Date.now())) return null;
  return deviceId;
}
function adminOk(req) {
  const token = req.cookies.admin_session;
  return validSession(token) && sessions.has(token) && sessions.get(token) === "admin";
}
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (e) {
    console.error("Telegram notification failed:", e.message);
  }
}

app.get("/api/device/status", (req, res) => {
  const deviceId = String(req.query.deviceId || "").slice(0, 200);
  if (!deviceId) return res.status(400).json({error:"Missing deviceId"});
  const row = db.prepare("SELECT revoked, expires_at, used, plan FROM devices WHERE device_id=?").get(deviceId);
  res.json({registered: !!row, active: !!row && !row.revoked && row.plan !== "pending" && (row.expires_at === 0 || row.expires_at > Date.now()), used: !!row?.used, plan: row?.plan || null});
});

app.post("/api/device/request", async (req, res) => {
  const deviceId = String(req.body.deviceId || "").slice(0, 200);
  if (!deviceId) return res.status(400).json({error:"Missing deviceId"});
  const now = Date.now();
  const existing = db.prepare("SELECT * FROM devices WHERE device_id=?").get(deviceId);
  if (existing && !existing.revoked && existing.plan !== "pending" && (existing.expires_at === 0 || existing.expires_at > now)) {
    return res.status(409).json({error:"This device already has an active access plan."});
  }
  db.prepare(`
    INSERT INTO devices(device_id,code_hash,expires_at,used,revoked,created_at,plan)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at,
      used=0, revoked=0, created_at=excluded.created_at, plan=excluded.plan
  `).run(deviceId, "", 0, 0, 0, now, "pending");
  await telegram(`🔐 BOSS X PRIME\nNew device access request\nDevice: ${deviceId}\nOpen Admin Panel and choose a duration to issue a password.`);
  res.json({ok:true, message:"Request sent. Wait for the administrator to approve a duration and issue your password."});
});

app.post("/api/device/login", (req, res) => {
  const deviceId = String(req.body.deviceId || "").slice(0, 200);
  const code = String(req.body.code || "").trim();
  const row = db.prepare("SELECT * FROM devices WHERE device_id=?").get(deviceId);
  if (!row || row.plan === "pending" || row.revoked || row.used || (row.expires_at !== 0 && row.expires_at < Date.now()) || hash(code) !== row.code_hash) {
    return res.status(401).json({error:"Invalid, expired, or already-used code."});
  }
  db.prepare("UPDATE devices SET used=1,last_seen=? WHERE device_id=?").run(Date.now(), deviceId);
  const token = makeSession(deviceId);
  sessions.set(token, deviceId);
  res.cookie("device_session", token, {httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV==="production", maxAge:7*86400000});
  res.json({ok:true});
});

app.get("/api/device/me", (req, res) => {
  const deviceId = activeDeviceSession(req);
  if (!deviceId) return res.status(401).json({error:"Not authorized or access plan expired."});
  res.json({ok:true, deviceId});
});

app.get("/api/protected", (req, res) => {
  const deviceId = activeDeviceSession(req);
  if (!deviceId) return res.status(401).json({error:"Not authorized or access plan expired."});
  res.json({ok:true});
});

app.post("/api/admin/login", (req,res) => {
  if (String(req.body.password || "") !== adminPassword) return res.status(401).json({error:"Wrong admin password"});
  const token = makeSession("admin");
  sessions.set(token, "admin");
  res.cookie("admin_session", token, {httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:86400000});
  res.json({ok:true});
});

app.post("/api/admin/issue-code", async (req,res) => {
  if (!adminOk(req)) return res.status(401).json({error:"Admin login required"});
  const id = Number(req.body.id);
  const plan = String(req.body.plan || "");
  const durations = {day:86400000, month:30*86400000, six_months:180*86400000, unlimited:0};
  if (!Number.isInteger(id) || !Object.prototype.hasOwnProperty.call(durations, plan)) return res.status(400).json({error:"Choose a valid device and duration."});
  const row = db.prepare("SELECT * FROM devices WHERE id=?").get(id);
  if (!row) return res.status(404).json({error:"Device request not found."});
  const code = randomCode();
  const now = Date.now();
  const expires = plan === "unlimited" ? 0 : now + durations[plan];
  db.prepare("UPDATE devices SET code_hash=?,expires_at=?,used=0,revoked=0,created_at=?,plan=? WHERE id=?").run(hash(code), expires, now, plan, id);
  const names = {day:"1 Day (24 hours)",month:"1 Month (30 days)",six_months:"6 Months (180 days)",unlimited:"Unlimited"};
  await telegram(`🔐 BOSS X PRIME\nACCESS PASSWORD ISSUED\nDevice: ${row.device_id}\nPlan: ${names[plan]}\nPassword: ${code}\nExpires: ${expires === 0 ? "Never (until revoked)" : new Date(expires).toISOString()}`);
  res.json({ok:true,message:"Password issued and sent to Telegram."});
});

app.get("/api/admin/devices", (req,res) => {
  if (!adminOk(req)) return res.status(401).json({error:"Admin login required"});
  const rows = db.prepare("SELECT id,device_id,expires_at,used,revoked,created_at,last_seen,plan FROM devices ORDER BY id DESC").all();
  res.json(rows);
});

app.post("/api/admin/revoke", (req,res) => {
  if (!adminOk(req)) return res.status(401).json({error:"Admin login required"});
  const id = Number(req.body.id);
  db.prepare("UPDATE devices SET revoked=1 WHERE id=?").run(id);
  res.json({ok:true});
});

app.use(express.static("public"));
app.listen(port, () => console.log(`BOSS X PRIME running on port ${port}`));