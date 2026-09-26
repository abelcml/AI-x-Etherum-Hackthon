import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService, actionArgs, lastJson, config } from '../src/commons-service.mjs';
import { createCommonsServer } from '../scripts/commons.mjs';

test('web action allowlist cannot inject send flags, commands, repositories or invalid amounts',()=>{
  assert.throws(()=>actionArgs({action:'shell'}),/Unsupported/);
  assert.throws(()=>actionArgs({action:'settle',jobId:'1 --send'}),/positive/);
  assert.throws(()=>actionArgs({action:'withdraw',role:'deployer'}),/Choose/);
  const input={action:'post',issueUrl:'https://github.com/org/repo/issues/1',title:'Fix parser',bounty:'1',window:3600};
  assert.throws(()=>actionArgs(input,{GITHUB_REPOSITORY:'other/repo'}),/configured/);
  assert.throws(()=>actionArgs({...input,bounty:'1e12'},{GITHUB_REPOSITORY:'org/repo'}),/six decimals/);
  assert.deepEqual(actionArgs(input,{GITHUB_REPOSITORY:'org/repo'}),['post','--issue','1','--title','Fix parser','--bounty','1','--window','3600']);
});
test('CLI adapter preserves argument boundaries and redacts secrets',async()=>{
  const service=createService({root:'.',env:{GITHUB_TOKEN:'secret-value'},executor:async(file,args,opts)=>{
    assert.equal(opts.shell,false);assert.ok(args.includes('a; echo private'));
    return {stdout:'secret-value\n'+JSON.stringify({mode:'dry-run',title:'braces { inside }'})+'\npreview only'};
  }});
  const output=await service.run(['post','--title','a; echo private']);
  assert.equal(output.result.mode,'dry-run');assert.equal(output.log.includes('secret-value'),false);
  assert.equal(lastJson('log\n{"a":1}\n{"b":2}').b,2);
});
test('actual CSV adapter produces and verifies output, rejecting altered output and changed input',()=>{
  const service=createService({root:'.'}), inputText='id,name\n1,Alice\n1,Other\n2,Bob\n';
  const result=service.csv({action:'run',inputText,key:'id'});
  assert.equal(result.outputText,'id,name\n1,Alice\n2,Bob\n');
  const request={action:'verify',inputText,key:'id',expectedSha:result.expectedSha256,outputText:result.outputText};
  assert.equal(service.csv(request).passed,true);
  assert.equal(service.csv({...request,outputText:'id,name\n'}).passed,false);
  assert.throws(()=>service.csv({...request,inputText:inputText+'3,Carol\n'}),/changed/);
  assert.throws(()=>service.csv({action:'run',inputText:'id,name\n1\n',key:'id'}),/row widths/);
});
test('real GitHub adapter yields a bound receipt without using wallet keys',async()=>{
  const sha='a'.repeat(40);
  const service=createService({root:'.',env:{GITHUB_REPOSITORY:'org/repo',GITHUB_CHECK_APP_ID:'1',GITHUB_REQUIRED_CHECKS:'CI'},fetchImpl:async(url,init)=>{
    assert.equal(init.method,'GET');
    const data=url.includes('/pulls/')?{base:{repo:{full_name:'org/repo'}},number:2,head:{sha},merged:true}:{total_count:1,check_runs:[{name:'CI',app:{id:1},head_sha:sha,status:'completed',conclusion:'success',id:7}]};
    return {ok:true,json:async()=>data,headers:{get:()=>null}};
  }});
  const receipt=await service.verify({pr:2,sha});
  assert.equal(receipt.verified,true);assert.equal(receipt.chain_verified,false);assert.equal(receipt.submitted_sha,receipt.pr_head_sha);
});

async function fixture(t,{signing=false,clock={time:1000},failure=false}={}) {
  const root=await mkdtemp(join(tmpdir(),'commons-test-'));const calls=[];
  const env=signing?{COMMONS_ENABLE_SIGNING:'true',COMMONS_USERNAME:'test',COMMONS_PASSWORD:'password'}:{};
  const service={config:()=>config(env),jobs:async()=>[],csv:()=>({passed:false}),verify:async()=>{throw new Error('GitHub rejected PR');},prIdentity:async()=>({}),run:async args=>{
    calls.push(args);if(failure&&args.includes('--send')){const error=new Error('Receipt unknown');error.uncertain=true;error.transactions=['0x'+'a'.repeat(64)];throw error;}
    return {result:{mode:args.includes('--send')?'send':'dry-run',jobId:'1'},log:''};
  }};
  const server=createCommonsServer({root,env,service,now:()=>clock.time});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}`;
  const headers=signing?{Authorization:'Basic '+Buffer.from('test:password').toString('base64')}:{};
  const configuration=await(await fetch(url+'/api/config',{headers})).json();
  const post=(path,data,extra={})=>fetch(url+path,{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Commons-CSRF':configuration.csrf,...extra},body:JSON.stringify(data)});
  return {url,headers,post,calls,clock};
}
test('HTTP API refuses cross-origin and missing CSRF requests',async t=>{
  const f=await fixture(t);
  assert.equal((await f.post('/api/preview',{action:'accept',jobId:1},{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.post('/api/preview',{action:'accept',jobId:1},{'X-Commons-CSRF':''})).status,403);
  assert.equal(f.calls.length,0);
});
test('default API can preview but cannot sign and failed verification stays failed',async t=>{
  const f=await fixture(t);const plan=await(await f.post('/api/preview',{action:'accept',jobId:1})).json();
  assert.equal(f.calls[0].includes('--send'),false);
  assert.equal((await f.post('/api/execute',{ticket:plan.ticket})).status,403);
  const failed=await f.post('/api/verify',{pr:1});assert.equal(failed.status,400);assert.equal((await failed.json()).verified,false);
});
test('signed action requires exact one-use preview, and expired tickets cannot send',async t=>{
  const f=await fixture(t,{signing:true});
  assert.equal((await fetch(f.url+'/api/config')).status,401);
  const plan=await(await f.post('/api/preview',{action:'accept',jobId:1})).json();
  assert.equal((await f.post('/api/execute',{ticket:plan.ticket,action:'post',jobId:99})).status,200);
  assert.deepEqual(f.calls[1],['accept','--job','1','--send']);
  assert.equal((await f.post('/api/execute',{ticket:plan.ticket})).status,409);
  const stale=await(await f.post('/api/preview',{action:'accept',jobId:2})).json();f.clock.time+=121000;
  assert.equal((await f.post('/api/execute',{ticket:stale.ticket})).status,409);
});
test('unknown receipt blocks later sends until operator review',async t=>{
  const f=await fixture(t,{signing:true,failure:true});
  const plan=await(await f.post('/api/preview',{action:'accept',jobId:1})).json();
  const result=await f.post('/api/execute',{ticket:plan.ticket});assert.equal(result.status,502);assert.equal((await result.json()).requiresManualReview,true);
  const retry=await(await f.post('/api/preview',{action:'accept',jobId:1})).json();
  assert.equal((await f.post('/api/execute',{ticket:retry.ticket})).status,409);
  assert.equal(f.calls.filter(args=>args.includes('--send')).length,1);
});
test('public serving and signing cannot start without authentication',()=>{
  assert.throws(()=>createCommonsServer({env:{COMMONS_PUBLIC_ORIGIN:'https://example.com'}}),/requires COMMONS/);
  assert.throws(()=>createCommonsServer({env:{COMMONS_ENABLE_SIGNING:'true'}}),/requires COMMONS/);
});
