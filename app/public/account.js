const app = document.querySelector('#accountApp');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const roleNames = { ADMIN: 'ผู้ดูแล', EDITOR: 'ผู้สร้างฟอร์ม', RESPONDENT: 'ผู้ตอบ' };
let status;
const candidate = new URLSearchParams(location.search).get('next') || '';
const next = /^\/(?:f\/[^/?#]+|(?:index|question-banks|question-packs)(?:\.html)?)?(?:\?[^#]*)?$/.test(candidate) ? candidate : '';
const token = new URLSearchParams(location.hash.slice(1)).get('token');
if (token) history.replaceState(null, '', location.pathname + location.search);
async function api(path, body, method = 'POST', secret = '') {
  const headers = { 'content-type':'application/json', ...(secret ? { authorization:`Bearer ${secret}` } : {}) };
  const response = await fetch(path, { method, headers, ...(method === 'GET' ? {} : { body:JSON.stringify(body || {}) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'ดำเนินการไม่สำเร็จ');
  return data;
}
function mark() { return status?.organization?.logoUrl ? `<img src="${escape(status.organization.logoUrl)}" alt="โลโก้องค์กร">` : '<div class="mark">AP+</div>'; }
function field(name, label, type = 'text', extra = '') { return `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" required ${extra}>`; }
function bindForm(id, action) {
  document.querySelector(id).onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button[type=submit]'), error = form.querySelector('.error');
    button.disabled = true; error.textContent = '';
    try { await action(Object.fromEntries(new FormData(form)), form); }
    catch (failure) { error.textContent = failure.message; }
    finally { if (button.isConnected) button.disabled = false; }
  };
}
function remember(user) { sessionStorage.setItem('goi_team_key','__account_session__'); sessionStorage.setItem('goi_member_name',user.name); }
function loginForm(message = '') {
  app.innerHTML = `<section class="card narrow"><div class="brand">${mark()}<strong>${escape(status.organization.name)}</strong></div><h1>เข้าสู่ระบบ</h1><p>${escape(message || 'ใช้บัญชีที่ผู้ดูแลองค์กรเชิญให้คุณ')}</p><form id="loginForm">${field('username','ชื่อบัญชี','text','autocomplete="username" maxlength="120"')}${field('password','รหัสผ่าน','password','autocomplete="current-password"')}<button class="primary full" type="submit">เข้าสู่ระบบ</button><div class="error" role="alert"></div></form><p class="small">หากลืมรหัสผ่าน ให้ติดต่อผู้ดูแลเพื่อขอลิงก์ตั้งรหัสผ่านใหม่</p></section>`;
  bindForm('#loginForm', async body => { const result = await api('/api/account/login',body); remember(result.user); location.href = next || '/account.html'; });
}
function setupForm() {
  app.innerHTML = `<section class="card narrow"><div class="mark">AP+</div><h1>ตั้งค่าองค์กรของคุณ</h1><p>สร้างผู้ดูแลคนแรก จากนั้นเชิญสมาชิกและเริ่มสร้างฟอร์มได้</p><form id="setupForm">${field('organizationName','ชื่อองค์กร','text','maxlength="120"')}<label for="logoUrl">URL โลโก้ (ไม่บังคับ)</label><input id="logoUrl" name="logoUrl" type="url" placeholder="https://…">${field('name','ชื่อผู้ดูแล','text','autocomplete="name" maxlength="120"')}${field('username','ชื่อบัญชีผู้ดูแล','text','autocomplete="username" maxlength="120" placeholder="เช่น admin หรือชื่ออีเมล"')}${field('password','รหัสผ่านใหม่','password','autocomplete="new-password" minlength="12"')}${field('setupKey','รหัสตั้งค่าระบบ','password','autocomplete="off"')}<p class="small">ใช้ TEAM_KEY ที่ตั้งไว้ตอนติดตั้ง เพื่อยืนยันสิทธิ์ตั้งระบบครั้งแรก</p><button class="primary full" type="submit">สร้างองค์กรและบัญชีผู้ดูแล</button><div class="error" role="alert"></div></form></section>`;
  bindForm('#setupForm',async body => { const {setupKey,...data}=body; const result=await api('/api/account/setup',data,'POST',setupKey); remember(result.user); location.href='/account.html'; });
}
function acceptForm() {
  app.innerHTML = `<section class="card narrow"><div class="mark">AP+</div><h1>ตั้งรหัสผ่านของคุณ</h1><p>ลิงก์เชิญหรือลิงก์ตั้งรหัสผ่านใหม่ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง</p><form id="acceptForm">${field('password','รหัสผ่านใหม่','password','autocomplete="new-password" minlength="12"')}${field('confirmation','ยืนยันรหัสผ่าน','password','autocomplete="new-password" minlength="12"')}<button class="primary full" type="submit">บันทึกรหัสผ่าน</button><div class="error" role="alert"></div></form></section>`;
  bindForm('#acceptForm',async body=>{if(body.password!==body.confirmation)throw new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');await api('/api/account/accept',{token,password:body.password});loginForm('ตั้งรหัสผ่านแล้ว ใช้ชื่อบัญชีที่ผู้ดูแลแจ้งให้คุณเข้าสู่ระบบ');});
}
function showLink(result) {
  document.querySelector('dialog')?.remove();
  document.body.insertAdjacentHTML('beforeend',`<dialog><h2>ลิงก์สำหรับ ${escape(result.user.name)}</h2><p>ส่งลิงก์นี้และชื่อบัญชี <strong>${escape(result.user.username)}</strong> ให้สมาชิกผ่านช่องทางที่คุณใช้ ลิงก์หมดอายุใน 24 ชั่วโมงและใช้ได้ครั้งเดียว</p><code class="link-box">${escape(result.invitationUrl)}</code><div class="actions"><button id="copyLink" class="primary">คัดลอกลิงก์</button><button id="closeDialog">ปิด</button></div><p class="small">ระบบไม่ได้ส่งอีเมลอัตโนมัติ หากปิดแล้วต้องการลิงก์ใหม่ กด “ออกลิงก์ใหม่” ในรายชื่อสมาชิก</p></dialog>`);
  const dialog=document.querySelector('dialog');dialog.showModal();document.querySelector('#closeDialog').onclick=()=>dialog.close();
  document.querySelector('#copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(result.invitationUrl);document.querySelector('#copyLink').textContent='คัดลอกแล้ว';}catch{document.querySelector('#copyLink').textContent='เลือกลิงก์ด้านบนเพื่อคัดลอก';}};
}
function roleOptions(selected = 'RESPONDENT') { return Object.entries(roleNames).map(([key,name])=>`<option value="${key}" ${key===selected?'selected':''}>${name}</option>`).join(''); }
async function dashboard() {
  const user=status.user, admin=user.role==='ADMIN';
  app.innerHTML=`<header class="header"><div class="brand">${mark()}<div><h1>${escape(status.organization.name)}</h1><p class="small">${escape(user.name)} · ${roleNames[user.role]}</p></div></div><div class="actions">${user.role!=='RESPONDENT'?'<a class="button primary" href="/">สร้างและจัดการฟอร์ม</a>':''}<button id="logout">ออกจากระบบ</button></div></header><div class="grid"><section class="card"><h2>ฟอร์มที่เปิดรับคำตอบ</h2><div class="forms" id="memberForms">กำลังโหลด…</div></section><section class="card"><h2>เปลี่ยนรหัสผ่าน</h2><form id="passwordForm">${field('currentPassword','รหัสผ่านเดิม','password','autocomplete="current-password"')}${field('password','รหัสผ่านใหม่','password','autocomplete="new-password" minlength="12"')}<button type="submit" class="full">บันทึกและเข้าสู่ระบบใหม่</button><div class="error" role="alert"></div></form></section></div>${admin?`<div class="grid"><section class="card"><h2>ข้อมูลองค์กร</h2><form id="brandingForm">${field('organizationName','ชื่อองค์กร','text','maxlength="120"')}<label for="logoUrl">URL โลโก้ (ไม่บังคับ)</label><input id="logoUrl" name="logoUrl" type="url"><button type="submit" class="full">บันทึกข้อมูลองค์กร</button><div class="error" role="alert"></div></form></section><section class="card"><h2>เชิญสมาชิก</h2><form id="inviteForm">${field('name','ชื่อสมาชิก','text','maxlength="120"')}${field('username','ชื่อบัญชี','text','maxlength="120" autocomplete="off"')}<label for="role">สิทธิ์</label><select id="role" name="role">${roleOptions()}</select><button type="submit" class="primary full">สร้างบัญชีและลิงก์เชิญ</button><div class="error" role="alert"></div></form></section></div><section class="card"><h2>สมาชิกองค์กร</h2><p class="small">ผู้สร้างฟอร์มจัดการฟอร์ม คำตอบ และคลังคำถามร่วมกัน ผู้ดูแลจัดการสมาชิกและการเชื่อมต่อแอปเพิ่มเติมได้</p><div id="users"></div><div id="usersError" class="error" role="alert"></div></section>`:''}`;
  document.querySelector('#logout').onclick=()=>APAccount.logout();
  bindForm('#passwordForm',async body=>{await api('/api/account/password',body);sessionStorage.removeItem('goi_team_key');location.href='/account.html';});
  const forms=await api('/api/account/forms',null,'GET');
  document.querySelector('#memberForms').innerHTML=forms.forms.length?forms.forms.map(form=>`<a href="/f/${encodeURIComponent(form.public_id)}">${escape(form.title)}</a>`).join(''):'<p class="muted">ยังไม่มีฟอร์มที่เปิดให้บัญชีนี้ตอบ</p>';
  if(admin){
    document.querySelector('#organizationName').value=status.organization.name;document.querySelector('#logoUrl').value=status.organization.logoUrl;
    bindForm('#brandingForm',async body=>{await api('/api/organization',body,'PATCH');location.reload();});
    bindForm('#inviteForm',async(body,form)=>{const result=await api('/api/organization/users',body);form.reset();await loadUsers();showLink(result);});
    await loadUsers();
  }
}
async function loadUsers() {
  const result=await api('/api/organization/users',null,'GET');
  document.querySelector('#users').innerHTML=`<div class="table-wrap"><table><thead><tr><th>สมาชิก</th><th>สิทธิ์</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${result.users.map(user=>`<tr data-user="${escape(user.id)}"><td><strong>${escape(user.name)}</strong><div class="muted small">${escape(user.username)}</div></td><td><select aria-label="สิทธิ์ของ ${escape(user.name)}" data-role>${roleOptions(user.role)}</select></td><td><select aria-label="สถานะของ ${escape(user.name)}" data-status>${user.status==='INVITED'?'<option value="INVITED">รอรับคำเชิญ</option>':`<option value="ACTIVE" ${user.status==='ACTIVE'?'selected':''}>ใช้งาน</option>`}<option value="DISABLED" ${user.status==='DISABLED'?'selected':''}>ปิดบัญชี</option></select></td><td><div class="actions"><button data-save>บันทึก</button><button data-reset ${user.status==='DISABLED'?'disabled':''}>ออกลิงก์ใหม่</button></div></td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-user]').forEach(row=>{
    const run=async action=>{document.querySelector('#usersError').textContent='';try{await action();}catch(error){document.querySelector('#usersError').textContent=error.message;}};
    row.querySelector('[data-save]').onclick=()=>run(async()=>{await api('/api/organization/users/'+encodeURIComponent(row.dataset.user),{role:row.querySelector('[data-role]').value,status:row.querySelector('[data-status]').value},'PATCH');await loadUsers();});
    row.querySelector('[data-reset]').onclick=()=>run(async()=>{const result=await api('/api/organization/users/'+encodeURIComponent(row.dataset.user)+'/reset');showLink(result);});
  });
}
async function start(){
  try{status=await APAccount.status();if(!status.configured){setupForm();return;}if(token){acceptForm();return;}if(!status.user){sessionStorage.removeItem('goi_team_key');loginForm();return;}remember(status.user);if(next&&(status.user.role!=='RESPONDENT'||next.startsWith('/f/'))){location.replace(next);return;}await dashboard();}
  catch(error){app.innerHTML=`<section class="card narrow"><h1>เปิดระบบไม่สำเร็จ</h1><p class="error">${escape(error.message)}</p><button onclick="location.reload()">ลองอีกครั้ง</button></section>`;}
}
start();
