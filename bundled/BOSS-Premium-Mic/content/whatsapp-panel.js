(() => {
  if (window.__bossXWhatsAppPanelLoaded) return;
  window.__bossXWhatsAppPanelLoaded = true;

  const EXT = globalThis.browser ?? globalThis.chrome;
  if (!EXT?.storage?.local) return;

  const DEFAULTS = {
    enabled: true,
    gainDb: 16,
    loudness: 1.8,
    maxBoost: 3,
    drive: 0.15,
    thresholdDb: -24,
    ratio: 4,
    limiterDb: -1,
    presenceDb: 3,
    lowShelfDb: 1,
    highShelfDb: 2,
    sustain: true,
    sustainTargetDb: -8,
    sustainMaxGain: 3,
    forceRawMic: false,
    reverbEnabled: false,
    reverbWet: 0.18,
    keepAlive: false,
    keepAliveGain: 0.0012,
    profileVersion: 9
  };

  const get = (key) => new Promise(resolve => {
    try {
      EXT.storage.local.get(key, r => resolve(r || {}));
    } catch (_) { resolve({}); }
  });

  const set = (value) => new Promise(resolve => {
    try { EXT.storage.local.set(value, () => resolve()); } catch (_) { resolve(); }
  });

  async function readConfig() {
    const r = await get("micMaximizerConfig");
    return { ...DEFAULTS, ...(r.micMaximizerConfig || {}) };
  }

  async function writeConfig(patch) {
    const cfg = await readConfig();
    await set({ micMaximizerConfig: { ...cfg, ...patch, profileVersion: 9 } });
    return { ...cfg, ...patch, profileVersion: 9 };
  }

  const root = document.createElement("div");
  root.id = "boss-x-whatsapp-control";
  root.style.cssText = "all:initial;position:fixed;right:14px;bottom:72px;z-index:2147483647;font-family:Arial,sans-serif;";
  document.documentElement.appendChild(root);
  const shadow = root.attachShadow({mode:"open"});

  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}
      .wrap{position:relative}
      .dotBtn{
        width:48px;height:48px;border-radius:50%;border:1px solid rgba(0,255,190,.45);
        background:linear-gradient(145deg,#0b1719,#00b98a);color:#eafff9;
        box-shadow:0 8px 30px rgba(0,0,0,.45),0 0 20px rgba(0,220,160,.16);
        cursor:pointer;font-size:22px;font-weight:900;line-height:1;
      }
      .dotBtn:active{transform:scale(.96)}
      .panel{
        position:absolute;right:0;bottom:58px;width:min(330px,calc(100vw - 28px));
        background:#071013;color:#e8fff8;border:1px solid #16433a;border-radius:18px;
        box-shadow:0 24px 80px rgba(0,0,0,.65);overflow:hidden;display:none;
      }
      .panel.open{display:block}
      .head{padding:14px 16px;border-bottom:1px solid #15302c;display:flex;align-items:center;justify-content:space-between}
      .head b{font-size:13px;letter-spacing:.08em}.head small{display:block;color:#6b8881;font-size:8px;margin-top:3px}
      .close{border:0;background:transparent;color:#8fa9a4;font-size:20px;cursor:pointer}
      .body{padding:14px 16px;max-height:62vh;overflow:auto}
      .status{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:10px;background:#091b18;margin-bottom:12px;font-size:11px}
      .status i{width:8px;height:8px;border-radius:50%;display:inline-block;background:#00dfab;margin-right:6px}
      .row{margin:11px 0}.row label{display:flex;justify-content:space-between;font-size:10px;color:#b9cbc7;margin-bottom:6px}
      input[type=range]{width:100%;accent-color:#00dca8}
      .value{color:#00e1ad}
      .toggle{display:flex;align-items:center;justify-content:space-between;font-size:10px;padding:8px 0;color:#c8d8d4}
      .toggle input{accent-color:#00dca8}
      .presets{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}
      button.preset{padding:9px;border-radius:9px;border:1px solid #20483f;background:#0a1719;color:#dffaf3;font-size:9px;cursor:pointer}
      button.preset:hover{border-color:#00dca8}
      .foot{padding:10px 16px;border-top:1px solid #15302c;color:#627b76;font-size:8px;text-align:center}
    </style>
    <div class="wrap">
      <section class="panel" id="panel">
        <div class="head"><div><b>BOSS X PRIME</b><small>WHATSAPP POWER AUDIO</small></div><button class="close" id="close">×</button></div>
        <div class="body">
          <div class="status"><span><i></i><span id="state">MIC ACTIVE</span></span><label><input id="enabled" type="checkbox"> ON</label></div>
          <div class="presets">
            <button class="preset" data-preset="royal">Royal Clear</button>
            <button class="preset" data-preset="lord">Balanced</button>
          </div>
          <div class="row"><label>Gain <span class="value" id="gainVal"></span></label><input id="gainDb" type="range" min="0" max="16" step=".1"></div>
          <div class="row"><label>Loudness <span class="value" id="loudVal"></span></label><input id="loudness" type="range" min=".5" max="3" step=".1"></div>
          <div class="row"><label>Bass <span class="value" id="bassVal"></span></label><input id="lowShelfDb" type="range" min="-12" max="12" step=".5"></div>
          <div class="row"><label>Treble <span class="value" id="trebleVal"></span></label><input id="highShelfDb" type="range" min="-12" max="12" step=".5"></div>
          <div class="row"><label>Presence <span class="value" id="presenceVal"></span></label><input id="presenceDb" type="range" min="-12" max="12" step=".5"></div>
          <div class="row"><label>Compressor Ratio <span class="value" id="ratioVal"></span></label><input id="ratio" type="range" min="1" max="20" step=".5"></div>
          <div class="toggle"><span>Anti-duck sustain</span><input id="sustain" type="checkbox"></div>
          <div class="toggle"><span>Limiter</span><input id="limiter" type="checkbox" checked></div>
        </div>
        <div class="foot">Settings are saved automatically to the BOSS Premium Mic extension.</div>
      </section>
      <button class="dotBtn" id="dots" aria-label="BOSS X extension settings">•••</button>
    </div>
  `;

  const panel = shadow.getElementById("panel");
  const dotBtn = shadow.getElementById("dots");
  shadow.getElementById("close").onclick = () => panel.classList.remove("open");
  dotBtn.onclick = () => panel.classList.toggle("open");

  const fields = ["gainDb","loudness","lowShelfDb","highShelfDb","presenceDb","ratio"];
  const checkboxFields = ["enabled","sustain"];

  function fmt(v) {
    const n=Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  function render(cfg) {
    for (const id of fields) {
      const el=shadow.getElementById(id); if(el) el.value=cfg[id];
    }
    for (const id of checkboxFields) {
      const el=shadow.getElementById(id); if(el) el.checked=!!cfg[id];
    }
    shadow.getElementById("gainVal").textContent=fmt(cfg.gainDb)+" dB";
    shadow.getElementById("loudVal").textContent=fmt(cfg.loudness);
    shadow.getElementById("bassVal").textContent=fmt(cfg.lowShelfDb)+" dB";
    shadow.getElementById("trebleVal").textContent=fmt(cfg.highShelfDb)+" dB";
    shadow.getElementById("presenceVal").textContent=fmt(cfg.presenceDb)+" dB";
    shadow.getElementById("ratioVal").textContent=fmt(cfg.ratio)+":1";
    shadow.getElementById("state").textContent=cfg.enabled ? "MIC ACTIVE" : "MIC BYPASSED";
  }

  async function applyPreset(name) {
    const presets = {
      royal:{enabled:true,gainDb:16,loudness:1.8,lowShelfDb:4,highShelfDb:6,presenceDb:8,ratio:12,sustain:true},
      lord:{enabled:true,gainDb:16,loudness:1.8,lowShelfDb:1,highShelfDb:2,presenceDb:3,ratio:4,sustain:true}
    };
    render(await writeConfig(presets[name]));
  }

  for (const id of fields) {
    shadow.getElementById(id).addEventListener("input", async e => {
      const cfg=await writeConfig({[id]:Number(e.target.value)});
      render(cfg);
    });
  }
  for (const id of checkboxFields) {
    shadow.getElementById(id).addEventListener("change", async e => {
      const cfg=await writeConfig({[id]:e.target.checked});
      render(cfg);
    });
  }
  shadow.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>applyPreset(b.dataset.preset)));

  readConfig().then(render);
  try {
    EXT.storage.onChanged.addListener(changes => {
      if (changes.micMaximizerConfig) readConfig().then(render);
    });
  } catch (_) {}
})();
