const activation=document.getElementById('activation'),msg=document.getElementById('activationMsg'),main=document.getElementById('main'),codeInput=document.getElementById('code');
const TELEGRAM_URL='https://t.me/BOSSX929';
const deviceId=(()=>{let k='boss_device_id',v=localStorage.getItem(k);if(!v){v=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2));localStorage.setItem(k,v)}return v})();
function unlock(){activation.style.display='none';main.classList.remove('locked')}
function validSaved(){try{const x=JSON.parse(localStorage.getItem('boss_access')||'null');return x&&(x.expiresAt===null||new Date(x.expiresAt)>new Date())}catch{return false}}
if(validSaved()) unlock();
document.getElementById('activateBtn').onclick=async()=>{msg.textContent='Checking password…';const code=codeInput.value.trim().toUpperCase();if(!code){msg.textContent='Please enter your password';return}try{const r=await fetch('/api/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,deviceId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Activation failed');localStorage.setItem('boss_access',JSON.stringify(d));unlock();toast(`Activated • ${d.plan}`)}catch(e){msg.textContent=e.message}};
codeInput.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('activateBtn').click()});
const planOptions=document.querySelectorAll('.plan-option');
planOptions.forEach(btn=>btn.addEventListener('click',()=>{
  planOptions.forEach(x=>x.classList.remove('selected'));
  btn.classList.add('selected');
  const plan=btn.dataset.plan;
  codeInput.placeholder=plan==='UNL'?'BOSS-UNL-XXXXXXXX':`BOSS-${plan}-XXXXXXXX`;
  codeInput.focus();
  const label=plan==='1D'?'1 Day':plan==='6M'?'6 Months':'Unlimited';
  msg.innerHTML=`${label} plan selected. Enter the matching BOSS password.${plan!=='UNL'?' <br><a href="'+TELEGRAM_URL+'" target="_blank" rel="noopener">Unlimited কিনতে Telegram-এ মেসেজ করুন</a>':''}`;
}));

function toast(t){const el=document.getElementById('toast');el.textContent=t;el.style.display='block';setTimeout(()=>el.style.display='none',2600)}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.action;if(a==='extension')location.href='/extensions/BOSS-Premium-Mic.zip';else if(a==='manage')toast('BOSS Premium Mic is ready to install.');else if(a==='add')toast('Add an extension from your device.');else if(a==='openWhatsApp')window.open('https://web.whatsapp.com/','_blank');else if(a==='openBusiness')window.open('https://business.whatsapp.com/','_blank')});
