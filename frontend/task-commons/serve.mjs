// Dependency-free preview. Exposes only the public frontend files, never the repo.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const port=Number(process.env.PORT||8780);
const files=new Map([['/',['index.html','text/html']],['/index.html',['index.html','text/html']],['/task-board.css',['task-board.css','text/css']],['/task-board.js',['task-board.js','text/javascript']],['/csv-adapter.js',['csv-adapter.js','text/javascript']]]);
http.createServer(async(req,res)=>{
 const item=files.get(new URL(req.url,'http://localhost').pathname);
 if(!item||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end('Not found');return;}
 try{const body=await readFile(new URL(item[0],import.meta.url));res.writeHead(200,{'Content-Type':item[1]+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);}catch{res.writeHead(500);res.end('Preview file unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`Task Commons: http://127.0.0.1:${port}`));
