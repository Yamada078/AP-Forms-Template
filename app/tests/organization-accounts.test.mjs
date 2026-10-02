import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';

class Statement {
  constructor(db,sql){this.db=db;this.sql=sql;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){return this.db.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:this.db.prepare(this.sql).all(...this.args)};}
  async run(){return {meta:{changes:Number(this.db.prepare(this.sql).run(...this.args).changes)}};}
}
class D1 {
  constructor(db){this.db=db;}
  prepare(sql){return new Statement(this.db,sql);}
  async batch(statements){this.db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());this.db.exec('COMMIT');return results;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
const password='a-long-test-password-2026';
async function fixture(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');db.exec(await readFile(new URL('../database/bootstrap.sql',import.meta.url),'utf8'));
  const env={DB:new D1(db),TEAM_KEY:'setup-only-test-secret'};
  const call=(path,{method='GET',body,cookie='',key='',origin='https://forms.test',headers={}}={})=>worker.fetch(new Request('https://forms.test'+path,{method,headers:{'content-type':'application/json',origin,'x-apforms-request':'1',...(cookie?{cookie}:{}),...(key?{authorization:`Bearer ${key}`} : {}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const setup=await call('/api/account/setup',{method:'POST',key:env.TEAM_KEY,body:{organizationName:'Test organization',name:'Owner',username:'owner',password}});assert.equal(setup.status,200,await setup.clone().text());
  const owner=(await setup.json()).user;const ownerCookie=setup.headers.get('set-cookie').split(';')[0];
  const invite=async(username,role='RESPONDENT')=>{
    const response=await call('/api/organization/users',{method:'POST',cookie:ownerCookie,body:{username,name:username,role}});assert.equal(response.status,201,await response.clone().text());const result=await response.json();const token=new URL(result.invitationUrl).hash.slice('#token='.length);
    const accept=await call('/api/account/accept',{method:'POST',body:{token,password}});assert.equal(accept.status,200,await accept.clone().text());
    const login=await call('/api/account/login',{method:'POST',body:{username,password}});assert.equal(login.status,200,await login.clone().text());return {...result,cookie:login.headers.get('set-cookie').split(';')[0],token};
  };
  const createForm=async()=>{
    const response=await call('/api/forms',{method:'POST',cookie:ownerCookie,body:{title:'Internal training'}});const {id}=await response.json();assert.ok(id);
    const saved=await call(`/api/forms/${id}`,{method:'PUT',cookie:ownerCookie,body:{version:5,title:'Training',startPage:{fields:[]},sections:[{id:'section',blocks:[],routingRules:[]}]}});assert.equal(saved.status,200);
    const published=await call(`/api/forms/${id}/publish`,{method:'POST',cookie:ownerCookie,body:{}});assert.equal(published.status,200);const publication=(await published.json()).publication;return {id,publicId:publication.publicId};
  };
  return {db,env,call,owner,ownerCookie,invite,createForm};
}

test('setup is one-time, sessions are HttpOnly and TEAM_KEY cannot bypass configured accounts',async()=>{
  const f=await fixture();try{
    const repeated=await f.call('/api/account/setup',{method:'POST',key:f.env.TEAM_KEY,body:{}});assert.equal(repeated.status,409);
    assert.equal((await f.call('/api/forms',{key:f.env.TEAM_KEY})).status,401);
    const status=await (await f.call('/api/account/status',{cookie:f.ownerCookie})).json();assert.equal(status.user.role,'ADMIN');assert.equal(status.organization.name,'Test organization');assert.equal(status.user.password_hash,undefined);
    const login=await f.call('/api/account/login',{method:'POST',body:{username:'OWNER',password}});const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
    assert.match(f.db.prepare('SELECT password_hash FROM organization_users').get().password_hash,/^\$2[aby]\$10\$/);
    assert.notEqual(f.db.prepare('SELECT token_hash FROM organization_sessions').get().token_hash,f.ownerCookie.split('=')[1]);
  }finally{f.db.close();}
});

test('roles and origin checks protect every management API, including collaboration tickets',async()=>{
  const f=await fixture();try{
    const editor=await f.invite('editor','EDITOR'),respondent=await f.invite('respondent');
    for(const path of ['/api/forms','/api/admin/question-banks','/api/admin/question-packs','/api/admin/integrations/applications'])assert.equal((await f.call(path,{cookie:respondent.cookie})).status,403,path);
    assert.equal((await f.call('/api/collab-ticket',{method:'POST',cookie:respondent.cookie,body:{}})).status,403);
    assert.equal((await f.call('/api/forms',{method:'POST',cookie:editor.cookie,body:{title:'Editor form'}})).status,201);
    assert.equal((await f.call('/api/organization/users',{cookie:editor.cookie})).status,403);
    assert.equal((await f.call('/api/admin/integrations/applications',{cookie:editor.cookie})).status,403);
    assert.equal((await f.call('/api/forms',{method:'POST',cookie:f.ownerCookie,origin:'https://attacker.test',body:{title:'Blocked'}})).status,403);
    assert.equal((await f.call('/api/account/logout',{method:'POST',cookie:f.ownerCookie,headers:{'x-apforms-request':''}})).status,403);
  }finally{f.db.close();}
});

test('member and selected form access is enforced for both schemas and submissions and records verified identity',async()=>{
  const f=await fixture();try{
    const member=await f.invite('member'),other=await f.invite('other');const form=await f.createForm();
    const policy=body=>f.call(`/api/forms/${form.id}/access`,{method:'PUT',cookie:f.ownerCookie,body});
    const submit=cookie=>f.call(`/api/public/forms/${form.publicId}/responses`,{method:'POST',cookie,body:{respondentName:'Claimed name',respondentMeta:{_account:{userId:'spoof'}},answers:{}}});
    assert.equal((await policy({mode:'MEMBERS'})).status,200);
    assert.equal((await f.call(`/api/public/forms/${form.publicId}`)).status,401);assert.equal((await submit('')).status,401);
    assert.equal((await f.call(`/api/public/forms/${form.publicId}`,{cookie:member.cookie})).status,200);assert.equal((await submit(member.cookie)).status,201);
    const response=f.db.prepare('SELECT respondent_user_id,respondent_meta FROM responses').get();assert.equal(response.respondent_user_id,member.user.id);assert.equal(JSON.parse(response.respondent_meta)._account.userId,member.user.id);
    assert.equal((await policy({mode:'SELECTED',memberIds:[member.user.id]})).status,200);
    assert.equal((await f.call(`/api/public/forms/${form.publicId}`,{cookie:other.cookie})).status,403);assert.equal((await submit(other.cookie)).status,403);assert.equal((await submit(member.cookie)).status,201);
    assert.equal((await f.call('/api/account/forms',{cookie:other.cookie})).status,200);assert.equal((await (await f.call('/api/account/forms',{cookie:other.cookie})).json()).forms.length,0);
    assert.equal((await policy({mode:'PUBLIC'})).status,200);assert.equal((await submit('')).status,201);
    const anonymous=f.db.prepare('SELECT respondent_meta FROM responses WHERE respondent_user_id IS NULL').get();assert.equal(JSON.parse(anonymous.respondent_meta)._account,undefined);
  }finally{f.db.close();}
});

test('invites and resets expire, are single-use, and reset revokes existing sessions',async()=>{
  const f=await fixture();try{
    const member=await f.invite('member');assert.equal((await f.call('/api/account/accept',{method:'POST',body:{token:member.token,password}})).status,410);
    const reset=await (await f.call(`/api/organization/users/${member.user.id}/reset`,{method:'POST',cookie:f.ownerCookie})).json();const token=new URL(reset.invitationUrl).hash.slice(7);
    assert.equal((await f.call('/api/account/accept',{method:'POST',body:{token,password:'replacement-password-2026'}})).status,200);
    assert.equal((await (await f.call('/api/account/status',{cookie:member.cookie})).json()).user,null);
    const expired=await (await f.call(`/api/organization/users/${member.user.id}/reset`,{method:'POST',cookie:f.ownerCookie})).json();f.db.prepare("UPDATE organization_tokens SET expires_at='2000-01-01'").run();
    assert.equal((await f.call('/api/account/accept',{method:'POST',body:{token:new URL(expired.invitationUrl).hash.slice(7),password}})).status,410);
  }finally{f.db.close();}
});

test('disable and role changes revoke sessions and the last active admin is preserved',async()=>{
  const f=await fixture();try{
    assert.equal((await f.call(`/api/organization/users/${f.owner.id}`,{method:'PATCH',cookie:f.ownerCookie,body:{role:'RESPONDENT'}})).status,409);
    assert.equal((await f.call(`/api/organization/users/${f.owner.id}`,{method:'PATCH',cookie:f.ownerCookie,body:{status:'DISABLED'}})).status,409);
    const editor=await f.invite('editor','EDITOR');assert.equal((await f.call(`/api/organization/users/${editor.user.id}`,{method:'PATCH',cookie:f.ownerCookie,body:{role:'RESPONDENT'}})).status,200);
    assert.equal((await f.call('/api/forms',{cookie:editor.cookie})).status,401);
    const member=await f.invite('member');assert.equal((await f.call(`/api/organization/users/${member.user.id}`,{method:'PATCH',cookie:f.ownerCookie,body:{status:'DISABLED'}})).status,200);
    assert.equal((await (await f.call('/api/account/status',{cookie:member.cookie})).json()).user,null);
    assert.equal((await f.call('/api/account/login',{method:'POST',body:{username:'member',password}})).status,401);
  }finally{f.db.close();}
});

test('password changes require current password, reject bcrypt truncation, and revoke sessions',async()=>{
  const f=await fixture();try{
    assert.equal((await f.call('/api/account/password',{method:'POST',cookie:f.ownerCookie,body:{currentPassword:'wrong',password:'a-new-password-2026'}})).status,401);
    assert.equal((await f.call('/api/account/password',{method:'POST',cookie:f.ownerCookie,body:{currentPassword:password,password:'ก'.repeat(25)}})).status,400);
    assert.equal((await f.call('/api/account/password',{method:'POST',cookie:f.ownerCookie,body:{currentPassword:password,password:'a-new-password-2026'}})).status,200);
    assert.equal((await f.call('/api/forms',{cookie:f.ownerCookie})).status,401);
  }finally{f.db.close();}
});

test('application keys cannot bypass member-only forms',async()=>{
  const f=await fixture();try{
    const form=await f.createForm();const appResponse=await f.call('/api/admin/integrations/applications',{method:'POST',cookie:f.ownerCookie,body:{name:'Backend'}});const application=(await appResponse.json()).application;
    assert.ok(application?.id);
    await f.call(`/api/forms/${form.id}/access`,{method:'PUT',cookie:f.ownerCookie,body:{mode:'PUBLIC'}});
    await f.call(`/api/admin/integrations/applications/${application.id}/permissions`,{method:'PUT',cookie:f.ownerCookie,body:{permissions:['read_form_schema','submit_response']}});
    await f.call(`/api/admin/integrations/applications/${application.id}/forms`,{method:'PUT',cookie:f.ownerCookie,body:{formIds:[form.id]}});
    const credential=await (await f.call(`/api/admin/integrations/applications/${application.id}/credentials`,{method:'POST',cookie:f.ownerCookie,body:{}})).json();assert.ok(credential.secret);
    assert.equal((await f.call(`/api/integrations/forms/${form.publicId}/schema`,{key:credential.secret})).status,200);
    await f.call(`/api/forms/${form.id}/access`,{method:'PUT',cookie:f.ownerCookie,body:{mode:'MEMBERS'}});
    assert.equal((await f.call(`/api/integrations/forms/${form.publicId}/schema`,{key:credential.secret})).status,403);
    assert.equal((await f.call(`/api/integrations/forms/${form.publicId}/responses`,{method:'POST',key:credential.secret,body:{answers:{}}})).status,403);
  }finally{f.db.close();}
});

test('repeated failed login is limited in the database across requests',async()=>{
  const f=await fixture();try{for(let attempt=0;attempt<12;attempt++)assert.equal((await f.call('/api/account/login',{method:'POST',body:{username:'owner',password:'wrong'}})).status,401);assert.equal((await f.call('/api/account/login',{method:'POST',body:{username:'owner',password}})).status,429);}finally{f.db.close();}
});

test('organization migration preserves pre-existing forms and responses and leaves their access public',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const bootstrap=await readFile(new URL('../database/bootstrap.sql',import.meta.url),'utf8');
    db.exec(bootstrap.split('-- migrations/0010_organization_accounts.sql')[0]);
    db.prepare('INSERT INTO forms (id,title,data,published,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('existing','Existing','{}',0,'2026-01-01','2026-01-01');
    db.prepare('INSERT INTO responses (id,form_id,respondent_name,answers,path,created_at) VALUES (?,?,?,?,?,?)').run('response','existing','Existing member','{}','[]','2026-01-01');
    db.exec(await readFile(new URL('../migrations/0010_organization_accounts.sql',import.meta.url),'utf8'));
    assert.equal(db.prepare('SELECT access_mode FROM forms').get().access_mode,'PUBLIC');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM responses').get().n,1);assert.equal(db.prepare('SELECT respondent_user_id FROM responses').get().respondent_user_id,null);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close();}
});


test('new form defaults follow the requested interface language without changing the authored title',async()=>{
 const f=await fixture();try{
  for(const [language,section,next,name]of [['en','Section 1','Next','Name'],['th','ส่วนที่ 1','ถัดไป','ชื่อ']]){
   const created=await f.call('/api/forms',{method:'POST',cookie:f.ownerCookie,body:{title:'ชื่อ',language}});assert.equal(created.status,201);const {id}=await created.json();
   const loaded=await f.call('/api/forms/'+id,{cookie:f.ownerCookie});const {form}=await loaded.json();assert.equal(form.title,'ชื่อ');assert.equal(form.sections[0].title,section);assert.equal(form.sections[0].nextLabel,next);assert.equal(form.startPage.fields[0].label,name);
  }
 }finally{f.db.close();}
});
