const $ = (id) => document.getElementById(id);

function deviceId() {
  let id = localStorage.getItem("bxp_device_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : "bxp-" + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem("bxp_device_id", id);
  }
  return id;
}
const DEVICE_ID = deviceId();
$("deviceState").textContent = "DEVICE " + DEVICE_ID.slice(0,8).toUpperCase();

function saveAccess(data) {
  localStorage.setItem("bxp_access", JSON.stringify(data));
}
function getAccess() {
  try { return JSON.parse(localStorage.getItem("bxp_access") || "null"); } catch { return null; }
}
function clearAccess() {
  localStorage.removeItem("bxp_access");
  updateGate();
}
function validAccess() {
  const x = getAccess();
  if (!x?.ok) return false;
  if (x.expiresAt && new Date(x.expiresAt) <= new Date()) return false;
  return true;
}
function updateGate() {
  const ok = validAccess();
  document.querySelectorAll("[data-feature]").forEach(el => el.classList.toggle("unlocked", ok));
  $("audioLock").textContent = ok ? "UNLOCKED" : "LOCKED";
  $("audioLock").className = "pill " + (ok ? "" : "danger");
  const x = getAccess();
  if (ok && x) {
    $("licenseTitle").textContent = x.planName || "Activated";
    $("licenseInfo").textContent = x.expiresAt ? "Active until " + new Date(x.expiresAt).toLocaleString() : "Unlimited device license is active.";
    $("loginMsg").textContent = "✓ This device is activated.";
  } else {
    $("licenseTitle").textContent = "Locked";
    $("licenseInfo").textContent = "Enter a valid license code and private password to unlock the Power Audio controls.";
  }
}
updateGate();

$("activate").addEventListener("click", async () => {
  const code = $("code").value.trim().toUpperCase();
  const password = $("password").value.trim();
  const msg = $("loginMsg");
  msg.textContent = "Checking license...";
  if (!code || !password) { msg.textContent = "Enter both code and password."; return; }
  try {
    const r = await fetch("/api/activate", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({code,password,deviceId:DEVICE_ID})
    });
    const data = await r.json();
    if (!data.ok) { msg.textContent = "✕ " + (data.error || "Activation failed."); return; }
    saveAccess({ok:true,plan:data.plan,planName:data.planName,expiresAt:data.expiresAt,code});
    msg.textContent = "✓ Activated successfully.";
    updateGate();
    document.querySelector("#audio").scrollIntoView({behavior:"smooth"});
  } catch(e) { msg.textContent = "✕ Server connection failed."; }
});
$("logoutDevice").addEventListener("click", () => {
  localStorage.removeItem("bxp_access");
  $("loginMsg").textContent = "Device license cleared locally.";
  updateGate();
});

/* Power Audio web mic test. The installed BOSS Premium Mic extension, when present, is separate from this page.
   A normal webpage cannot directly attach its Web Audio graph to WhatsApp's private WebRTC call stream. */
let audio = {ctx:null, stream:null, source:null, nodes:null, raf:null};

function dbToGain(db){ return Math.pow(10, Number(db)/20); }
function setupGraph(stream) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("Web Audio API unavailable");
  const ctx = new AC({latencyHint:"interactive"});
  const source = ctx.createMediaStreamSource(stream);
  const bass = ctx.createBiquadFilter(); bass.type="lowshelf"; bass.frequency.value=200;
  const presence = ctx.createBiquadFilter(); presence.type="peaking"; presence.frequency.value=3200; presence.Q.value=1.5;
  const treble = ctx.createBiquadFilter(); treble.type="highshelf"; treble.frequency.value=6000;
  const comp = ctx.createDynamicsCompressor();
  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser(); analyser.fftSize=1024; analyser.smoothingTimeConstant=.2;
  source.connect(bass).connect(presence).connect(treble).connect(comp).connect(gain).connect(analyser);
  audio = {ctx,stream,source,nodes:{bass,presence,treble,comp,gain,analyser},raf:null};
  applyAudioSettings();
  meterLoop();
}
function applyAudioSettings(){
  if (!audio.nodes) return;
  const n=audio.nodes;
  n.gain.gain.value=Number($("gain").value);
  n.comp.ratio.value=Number($("comp").value);
  n.comp.threshold.value=-24;
  n.comp.knee.value=20;
  n.comp.attack.value=.001;
  n.comp.release.value=.08;
  n.presence.gain.value=Number($("presence").value);
  n.bass.gain.value=Number($("bass").value);
  n.treble.gain.value=Number($("treble").value);
}
function meterLoop(){
  if (!audio.nodes?.analyser) return;
  const buf=new Uint8Array(audio.nodes.analyser.fftSize);
  const tick=()=>{
    if (!audio.nodes?.analyser) return;
    audio.nodes.analyser.getByteTimeDomainData(buf);
    let sum=0; for(const v of buf){const s=(v-128)/128;sum+=s*s;}
    const rms=Math.sqrt(sum/buf.length);
    const db=20*Math.log10(Math.max(rms,.00001));
    const pct=Math.max(0,Math.min(100,(db+60)/60*100));
    $("levelBar").style.width=pct+"%";
    $("levelText").textContent=db < -59 ? "-∞ dB" : db.toFixed(1)+" dB";
    audio.raf=requestAnimationFrame(tick);
  };
  tick();
}
$("micStart").addEventListener("click", async()=>{
  if (!validAccess()) { $("loginMsg").textContent="Activate your device license first."; $("login").scrollIntoView({behavior:"smooth"}); return; }
  if (audio.stream) {
    audio.stream.getTracks().forEach(t=>t.stop());
    if(audio.raf) cancelAnimationFrame(audio.raf);
    try{await audio.ctx?.close()}catch{}
    audio={ctx:null,stream:null,source:null,nodes:null,raf:null};
    $("micStart").textContent="START MIC TEST";
    $("levelBar").style.width="0";
    $("levelText").textContent="-∞ dB";
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{
      echoCancellation:false,noiseSuppression:false,autoGainControl:false
    }});
    setupGraph(stream);
    $("micStart").textContent="STOP MIC TEST";
  }catch(e){ $("loginMsg").textContent="Microphone permission was not granted."; }
});
["gain","comp","presence","bass","treble","sustain"].forEach(id=>{
  $(id).addEventListener("input",()=>{
    const map={gain:"gainOut",comp:"compOut",presence:"presenceOut",bass:"bassOut",treble:"trebleOut"};
    if(map[id]) $(map[id]).textContent = id==="gain" ? Number($(id).value).toFixed(1)+"x" : id==="comp" ? Number($(id).value).toFixed(1)+":1" : Number($(id).value).toFixed(1)+" dB";
    applyAudioSettings();
  });
});

window.addEventListener("beforeunload",()=>{
  audio.stream?.getTracks().forEach(t=>t.stop());
});
      
