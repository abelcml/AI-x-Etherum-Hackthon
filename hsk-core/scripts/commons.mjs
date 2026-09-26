import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createService, actionArgs } from '../src/commons-service.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function createCommonsServer({root=projectRoot,env=process.env,service=createService({root,env}),now=Date.now}={}) {
  const tickets=new Map(); let sending=false, inFlight=0;
  const csrf=randomBytes(24).toString('hex');
  const publicOrigin=env.COMMONS_PUBLIC_ORIGIN ? new URL(env.COMMONS_PUBLIC_ORIGIN).origin : null;
  const hasAuth=Boolean(env.COMMONS_USERNAME && env.COMMONS_PASSWORD);
  if((publicOrigin || env.COMMONS_ENABLE_SIGNING==='true') && !hasAuth) throw new Error('Public access or signing requires COMMONS_USERNAME and COMMONS_PASSWORD');
  const credential=Buffer.from(`${env.COMMONS_USERNAME}:${env.COMMONS_PASSWORD}`).toString('base64');
  function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(data)); }
  async function body(req) {
    if(!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON body required');
    const chunks=[];let size=0;
    for await(const chunk of req) {size+=chunk.length;if(size>512000) throw new Error('Request too large');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  return createServer(async(req,res)=>{
    try {
      const host=req.headers.host || '';
      const allowedHost=publicOrigin ? new URL(publicOrigin).host : null;
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && host!==allowedHost) return json(res,403,{error:'Host is not configured for this service'});
      if(hasAuth) {
        const supplied=Buffer.from(req.headers.authorization || '');const expected=Buffer.from(`Basic ${credential}`);
        if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) {res.writeHead(401,{'WWW-Authenticate':'Basic realm="Task Commons"','Cache-Control':'no-store'}).end('Team login required');return;}
      }
      const pathname=new URL(req.url,'http://localhost').pathname;
      const origin=req.headers.origin;
      const sameOrigin=publicOrigin || `http://${host}`;
      if(req.headers['sec-fetch-site']==='cross-site' || (origin && origin!==sameOrigin)) return json(res,403,{error:'Cross-origin access refused'});
      if(req.method==='GET' && pathname==='/api/config') return json(res,200,{...service.config(),csrf});
      if(req.method==='GET' && pathname==='/api/jobs') return json(res,200,{jobs:await service.jobs()});
      if(req.method==='GET' && /^\/api\/jobs\/[1-9]\d*$/.test(pathname)) return json(res,200,await service.run(actionArgs({action:'status',jobId:pathname.split('/').pop()},env)));
      if(req.method==='POST' && pathname.startsWith('/api/')) {
        if(req.headers['x-commons-csrf']!==csrf) return json(res,403,{error:'Refresh the page before making this request'});
        if(inFlight>=8) return json(res,429,{error:'Too many pending requests'});
        inFlight++;
        try {
          const input=await body(req);
          if(pathname==='/api/verify') return json(res,200,await service.verify(input));
          if(pathname==='/api/pr') return json(res,200,await service.prIdentity(input.pr));
          if(pathname==='/api/csv') return json(res,200,service.csv(input));
          if(pathname==='/api/preview') {
            const args=actionArgs(input,env);
            if(args[0]==='status') return json(res,400,{error:'Use the read-only status endpoint'});
            const plan=await service.run(args);
            for(const [id,t] of tickets) if(t.expires<=now()) tickets.delete(id);
            if(tickets.size>=100) tickets.delete(tickets.keys().next().value);
            const ticket=randomBytes(24).toString('hex'); tickets.set(ticket,{args,expires:now()+120000});
            return json(res,200,{...plan,ticket,expiresIn:120,signingEnabled:service.config().signingEnabled});
          }
          if(pathname==='/api/execute') {
            if(!service.config().signingEnabled) return json(res,403,{error:'Server signing is disabled; preview only'});
            const ticket=tickets.get(input.ticket); tickets.delete(input.ticket);
            if(!ticket||ticket.expires<=now()) return json(res,409,{error:'Preview expired or already used; generate a new preview'});
            if(sending) return json(res,409,{error:'Another transaction is in progress; wait for its result'});
            try {await readFile(resolve(root,'.data/commons-pending.json'));return json(res,409,{error:'An earlier transaction needs manual receipt review before another send'});} catch(error) {if(error.code!=='ENOENT') throw error;}
            sending=true;tickets.clear();
            try {return json(res,200,await service.run([...ticket.args,'--send']));}
            catch(error) {
              if(error.uncertain) {await mkdir(resolve(root,'.data'),{recursive:true});await writeFile(resolve(root,'.data/commons-pending.json'),JSON.stringify({action:ticket.args[0],transactions:error.transactions||[],recordedAt:new Date().toISOString()}));}
              return json(res,502,{error:error.message,transactions:error.transactions||[],requiresManualReview:Boolean(error.uncertain)});
            } finally {sending=false;}
          }
          return json(res,404,{error:'Unknown API endpoint'});
        } finally {inFlight--;}
      }
      const staticPaths={'/':['index.html','text/html'],'/demo':['demo.html','text/html'],'/assets/task-board.css':['styles.css','text/css'],'/assets/task-board.js':['app.js','text/javascript']};
      const asset=staticPaths[pathname];
      if(!asset||!['GET','HEAD'].includes(req.method)) return json(res,404,{error:'Not found'});
      const content=await readFile(resolve(root,'web/commons',asset[0]));
      res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}).end(req.method==='HEAD'?undefined:content);
    } catch(error) {json(res,400,{error:error.message,verified:false});}
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT || 4174);
  createCommonsServer().listen(port,'127.0.0.1',()=>console.log(`Task Commons: http://127.0.0.1:${port} (real adapters; signing requires explicit configuration)`));
}
