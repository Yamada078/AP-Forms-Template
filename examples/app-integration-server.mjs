import { createServer } from 'node:http';
const base=process.env.API_BASE_URL, formId=process.env.PUBLIC_FORM_ID, key=process.env.INTEGRATION_KEY;
if(!base||!formId||!key)throw new Error('Set API_BASE_URL, PUBLIC_FORM_ID and INTEGRATION_KEY.');
const target=new URL(base);if(!['https:','http:'].includes(target.protocol))throw new Error('API_BASE_URL must be an HTTP URL.');
const origin='http://127.0.0.1:8812';
const page=`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AP+forms · ทดลองเชื่อมแอป</title><style>body{font:16px system-ui;background:#111827;color:#e5e7eb;max-width:850px;margin:40px auto;padding:20px}button,input,textarea{font:inherit;padding:12px;border-radius:8px}input,textarea{width:100%;box-sizing:border-box;margin:8px 0 20px}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1f2937;padding:20px;border-radius:12px}label{display:block}</style><h1>ทดลองเชื่อม AP+forms</h1><p>รหัสเชื่อมต่ออยู่ในเซิร์ฟเวอร์ตัวอย่าง หน้านี้ใช้ตรวจ schema และส่งคำตอบทดลอง</p><button id="read">อ่านฟอร์ม</button><pre id="schema">ยังไม่ได้อ่านฟอร์ม</pre><form id="form"><label>ชื่อผู้ตอบ<input name="name" required></label><label>คำตอบ JSON<textarea name="answers" rows="6">{}</textarea></label><label>ข้อมูลผู้ตอบเพิ่มเติม JSON<textarea name="meta" rows="3">{}</textarea></label><button>ส่งคำตอบ</button></form><pre id="result" role="status"></pre><script>let version;const result=document.querySelector('#result');document.querySelector('#read').onclick=async()=>{try{const r=await fetch('/schema');const data=await r.json();document.querySelector('#schema').textContent=JSON.stringify(data,null,2);if(r.ok)version=data.publishedVersion;}catch(e){result.textContent=e.message;}};document.querySelector('#form').onsubmit=async e=>{e.preventDefault();try{if(!version)throw new Error('อ่านฟอร์มก่อนส่งคำตอบ');const data=new FormData(e.currentTarget);const r=await fetch('/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publishedVersion:version,respondentName:data.get('name'),respondentMeta:JSON.parse(data.get('meta')),answers:JSON.parse(data.get('answers')),source:{platform:'web',version:'demo-1'}})});result.textContent=JSON.stringify(await r.json(),null,2);}catch(error){result.textContent=error.message;}};</script></html>`;
createServer(async(request,response)=>{
  response.setHeader('cache-control','no-store');
  try{
    if(request.headers.host!=='127.0.0.1:8812'){response.writeHead(403);response.end();return;}
    if(request.url==='/'&&request.method==='GET'){response.setHeader('content-type','text/html; charset=utf-8');response.end(page);return;}
    let body;
    if(request.url==='/responses'&&request.method==='POST'){
      if(request.headers.origin!==origin){response.writeHead(403);response.end();return;}
      const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>256*1024){response.writeHead(413);response.end();return;}chunks.push(chunk);}body=Buffer.concat(chunks).toString('utf8');
    }else if(request.url!=='/schema'||request.method!=='GET'){response.writeHead(404);response.end();return;}
    const path=`/api/integrations/forms/${encodeURIComponent(formId)}/${request.url==='/schema'?'schema':'responses'}`;
    const upstream=await fetch(new URL(path,target),{method:body?'POST':'GET',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body,signal:AbortSignal.timeout(15000),redirect:'error'});
    response.writeHead(upstream.status,{'content-type':'application/json; charset=utf-8'});response.end(await upstream.text());
  }catch{response.writeHead(502,{'content-type':'application/json'});response.end(JSON.stringify({error:'เชื่อมต่อ AP+forms ไม่สำเร็จ ตรวจ URL และสถานะเซิร์ฟเวอร์'}));}
}).listen(8812,'127.0.0.1',()=>console.log(`Integration demo: ${origin}`));
