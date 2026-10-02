import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root=normalize(join(import.meta.dirname,'..','public')),fixture=join(import.meta.dirname,'logic-canvas-fixture.html');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer(async(request,response)=>{try{const relative=decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/,''),path=request.url==='/'?fixture:normalize(join(root,relative));if(path!==fixture&&!path.startsWith(root))throw new Error('invalid');const data=await readFile(path);response.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');response.end(data)}catch{response.writeHead(404);response.end('Not found')}});
server.listen(41732,'127.0.0.1',()=>console.log('Logic Canvas fixture: http://127.0.0.1:41732'));
