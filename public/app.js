const activation=document.getElementById('activation'),msg=document.getElementById('activationMsg'),main=document.getElementById('main'),codeInput=document.getElementById('code');
const TELEGRAM_URL='https://t.me/BOSSX929';
const deviceId=(()=>{let k='boss_device_id',v=localStorage.getItem(k);if(!v){v=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2));localStorage.setItem(k,v)}return v})();
function unlock(){activation.style.display='none';main.classList.remove('locked')}
function validSaved(){try{const x=JSON.parse(localStorage.getItem('boss_access')||'null');return x&&(x.expiresAt===null||new Date(x.expiresAt)>new Date())}catch{return false}}
if(validSaved()) unlock();
document.getElementById('activateBtn').onclick=async()=>{msg.textContent='Checking password…';const code=codeInput.value.trim().toUpperCase();if(!code){msg.textContent='Please enter your password';return}try{const r=await fetch('/api/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,deviceId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Activation failed');localStorage.setItem('boss_access',JSON.stringify(d));unlock();toast(`Activated • ${d.plan}`)}catch(e){msg.textContent=e.message}};
codeInput.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('activateBtn').click()});
const planOptions=document.querySelectorAll('.plan-option');
const planInfo={
  '1D':{label:'1 Day',message:'Hello, I want to buy 1 Day Premium and get my password.'},
  '6M':{label:'6 Months',message:'Hello, I want to buy 6 Months Premium and get my password.'},
  'UNL':{label:'Unlimited',message:'Hello, I want to buy Unlimited Premium and get my password.'}
};
planOptions.forEach(btn=>btn.addEventListener('click',()=>{
  planOptions.forEach(x=>x.classList.remove('selected'));
  btn.classList.add('selected');
  const plan=btn.dataset.plan;
  const info=planInfo[plan];
  codeInput.placeholder=plan==='UNL'?'BOSS-UNL-XXXXXXXX':`BOSS-${plan}-XXXXXXXX`;
  msg.innerHTML=`${info.label} selected. <b>Telegram খুলছে…</b>`;
  const url=TELEGRAM_URL+'?text='+encodeURIComponent(info.message);
  window.open(url,'_blank','noopener');
}));

function toast(t){const el=document.getElementById('toast');el.textContent=t;el.style.display='block';setTimeout(()=>el.style.display='none',2600)}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.action;if(a==='extension')location.href='/extensions/BOSS-Premium-Mic.zip';else if(a==='manage')toast('BOSS Premium Mic is ready to install.');else if(a==='add')toast('Add an extension from your device.');else if(a==='openWhatsApp')window.open('https://web.whatsapp.com/','_blank');else if(a==='openBusiness')window.open('https://business.whatsapp.com/','_blank')});
