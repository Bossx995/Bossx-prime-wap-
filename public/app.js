const activation=document.getElementById('activation');
const msg=document.getElementById('activationMsg');
const main=document.getElementById('main');
const codeInput=document.getElementById('code');
const deviceId=(()=>{let k='boss_device_id',v=localStorage.getItem(k);if(!v){v=crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2);localStorage.setItem(k,v)}return v})();
function unlock(){activation.style.display='none';main.classList.remove('locked');}
const saved=localStorage.getItem('boss_access');
if(saved){try{const x=JSON.parse(saved);if(new Date(x.expiresAt)>new Date())unlock();}catch{}}
document.getElementById('activateBtn').onclick=async()=>{msg.textContent='Checking…';try{const r=await fetch('/api/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:codeInput.value,deviceId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Activation failed');localStorage.setItem('boss_access',JSON.stringify(d));unlock();toast(`Activated — ${d.plan}`)}catch(e){msg.textContent=e.message}};
function toast(t){const el=document.getElementById('toast');el.textContent=t;el.style.display='block';setTimeout(()=>el.style.display='none',2600)}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.action;if(a==='extension'){window.location='/extensions/BOSS-Premium-Mic.zip'}else if(a==='manage'){toast('Extension manager is ready. Download BOSS Premium Mic below.')}else if(a==='add'){toast('Use the BOSS Premium Mic package to add the extension.')}else if(a==='openWhatsApp'){window.open('https://web.whatsapp.com/','_blank')}else if(a==='openBusiness'){window.open('https://business.whatsapp.com/','_blank')}});
