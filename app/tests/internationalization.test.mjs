import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const catalog=readFileSync(new URL('../public/i18n-translations.js',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../public/i18n.js',import.meta.url),'utf8');
function start({search='',language='en-US',saved=null,blocked=false}={}){
 const stored=new Map(saved?[['apforms_language',saved]]:[]);
 const context=vm.createContext({URLSearchParams,location:{search},navigator:{language},localStorage:{getItem(key){if(blocked)throw Error('blocked');return stored.get(key)},setItem(key,value){if(blocked)throw Error('blocked');stored.set(key,value)}}});
 vm.runInContext(catalog,context);vm.runInContext(runtime,context);return{api:context.APFormsI18n,stored,context};
}
test('language preference follows an explicit supported URL, saved choice or browser language',()=>{
 assert.equal(start({language:'th-TH'}).api.language,'th');assert.equal(start().api.language,'en');
 assert.equal(start({saved:'th'}).api.language,'th');assert.equal(start({saved:'th',search:'?lang=en'}).api.language,'en');
 assert.equal(start({search:'?lang=fr',saved:'th'}).api.language,'th');assert.equal(start({saved:'constructor'}).api.language,'en');
});
test('language selection works when browser storage is unavailable',async()=>{
 assert.equal(start({blocked:true,language:'th-TH',search:'?lang=en'}).api.language,'en');const{api}=start({blocked:true,language:'th-TH'});assert.equal(api.language,'th');await api.setLanguage('en');assert.equal(api.language,'en');assert.equal(api.text('เข้าสู่ระบบ'),'Sign in');
});
test('template translation preserves every authored interpolation value',()=>{
 const{api}=start();const title='ชื่อ',question='คำถามใหม่',answer='บันทึก',escaped='&lt;img src=x onerror=alert(1)&gt;';
 assert.equal(api.html(['<h1>ชื่อ</h1><p>','</p><b>','</b><i>','</i><em>','</em>'],title,question,answer,escaped),'<h1>Name</h1><p>ชื่อ</p><b>คำถามใหม่</b><i>บันทึก</i><em>&lt;img src=x onerror=alert(1)&gt;</em>');
});
test('server validation messages translate fixed text without changing field labels',()=>{
 const{api}=start();assert.equal(api.message('ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง'),'Incorrect username or password.');
 const translated=api.message('กรุณากรอกข้อมูลที่จำเป็น: ชื่อ');assert.equal(translated,'Complete the required fields: ชื่อ');
 assert.equal(api.message('PRIVATE_CUSTOM_MESSAGE'),'PRIVATE_CUSTOM_MESSAGE');
});
test('cached role and difficulty labels follow subsequent language changes',async()=>{
 const{api}=start();const roles=api.labels({ADMIN:api.text('ผู้ดูแล'),nested:[api.text('ง่ายมาก')]});
 assert.equal(roles.ADMIN,'Administrator');await api.setLanguage('th');assert.equal(roles.ADMIN,'ผู้ดูแล');assert.equal(roles.nested[0],'ง่ายมาก');
 await api.setLanguage('en');assert.equal(roles.ADMIN,'Administrator');assert.equal(roles.nested[0],'Very easy');
});
test('changing interface language does not change an existing form or response',async()=>{
 const{api,stored}=start();const form={title:'ชื่อ',question:'คำถามใหม่',answer:'บันทึก'};const original=structuredClone(form);let renders=0;
 const unregister=api.register({render(){renders++;assert.equal(api.html(['<label>ชื่อ</label><span>','</span>'],form.title),api.language==='en'?'<label>Name</label><span>ชื่อ</span>':'<label>ชื่อ</label><span>ชื่อ</span>')}});
 await api.setLanguage('th');await api.setLanguage('en');assert.deepEqual(form,original);assert.equal(renders,2);assert.deepEqual([...stored.keys()],['apforms_language']);unregister();
});
test('unsupported languages cannot alter the selected locale or stored preference',async()=>{
 const{api,stored}=start();assert.equal(await api.setLanguage('fr'),false);assert.equal(api.locale,'en-US');assert.equal(stored.size,0);await api.setLanguage('th');assert.equal(api.locale,'th-TH');
});