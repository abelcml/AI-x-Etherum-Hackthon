const $=id=>document.getElementById(id);
let configuration,scenario='code',jobs=[],jobStatus=null,receipt=null,csvExpected=null,ticket=null,busy=false;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,input) {
  const response=await fetch(path,{method:input===undefined?'GET':'POST',headers:input===undefined?{}:{'Content-Type':'application/json','X-Commons-CSRF':configuration?.csrf||''},body:input===undefined?undefined:JSON.stringify(input)});
  let data;try{data=await response.json();}catch{throw new Error('服务未返回 JSON，请检查登录或服务地址');}
  if(!response.ok) {const error=new Error(data.error||`HTTP ${response.status}`);error.details=data;throw error;}
  return data;
}
function display(data) {$('result').textContent=JSON.stringify(data,null,2);}
function evidence(data) {
  receipt=data;$('download-receipt').disabled=!data;
  $('evidence-summary').textContent=!data?'尚未验证':data.verified===true||data.passed===true?'验收通过（未付款）':'验收失败';
  const rows=!data?[['验收状态','未执行']]:Object.entries(data).filter(([key])=>!['checks','log','policy'].includes(key)).map(([key,value])=>[key,typeof value==='object'?JSON.stringify(value):value]);
  $('checks').innerHTML=rows.map(([key,value])=>`<tr><td>${esc(key)}</td><td>${esc(value)}</td></tr>`).join('');
}
function invalidate() {evidence(null);$('status').textContent=scenario==='csv'?'待验收':jobStatus?.status||'待验收';}
async function operation(fn) {
  if(busy)return;busy=true;$('action-note').textContent='正在读取或执行实际接口…';document.body.setAttribute('aria-busy','true');
  try{await fn();}catch(error){display(error.details||{error:error.message});$('action-note').textContent=error.message;}
  finally{busy=false;document.body.removeAttribute('aria-busy');}
}
function jobId(){const value=$('job-id').value.trim();if(!/^[1-9]\d*$/.test(value))throw new Error('先选择任务或填写链上任务 ID');return value;}
async function refresh() {
  configuration=await api('/api/config');
  $('mode-note').textContent=configuration.signingEnabled?'已启用测试钱包签名，每次操作仍须预览和确认':'真实读取与验收可用；交易默认只预览';
  $('signing-status').textContent=configuration.signingEnabled?'已启用，逐笔确认':'仅预览，发送关闭';
  $('config-status').textContent=configuration.missing.length?`待配置：${configuration.missing.join('、')}`:'配置字段齐全；合约与 RPC 在操作时实际验证。';
  $('network-status').textContent=configuration.missing.some(key=>key.endsWith('_ADDRESS'))?'待配置合约':'操作时核对链';
  const data=await api('/api/jobs');jobs=data.jobs;
  $('job-select').innerHTML='<option value="">选择真实任务</option>'+jobs.map(job=>`<option value="${esc(job.jobId)}">#${esc(job.jobId)} ${esc(job.title)}</option>`).join('');
  $('action-note').textContent=jobs.length?`已读取 ${jobs.length} 份 CLI 任务记录。`:'没有已发布的任务记录；CSV 可直接运行，GitHub 验收需配置仓库。';
}
async function loadJob() {
  const data=await api(`/api/jobs/${jobId()}`);jobStatus=data.result;display(jobStatus);
  $('status').textContent=jobStatus.status;$('balance').textContent=jobStatus.bounty;
  $('balance-note').textContent=`Worker 可领取：${jobStatus.workerClaimable}；Requester 可领取：${jobStatus.requesterClaimable}。可领取不等于已到账。`;
  $('action-note').textContent='以上状态直接来自链上读取。';
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function preview(input) {
  ticket=null;$('send-transaction').disabled=true;
  const data=await api('/api/preview',input);display(data.result);ticket=data.ticket;
  $('transaction-plan').textContent=JSON.stringify(data.result,null,2);
  $('transaction-warning').textContent=data.signingEnabled?'预览两分钟内有效。发送后等待回执，不要重复操作。':'发送尚未启用。需在服务器配置测试钱包、团队登录及 COMMONS_ENABLE_SIGNING。';
  $('send-transaction').disabled=!data.signingEnabled;$('transaction-dialog').showModal();
  $('action-note').textContent='交易预览完成，尚未签名或发送。';
}
function setScenario(value){
  if(busy)return;scenario=value;invalidate();$('status').textContent=value==='code'?'未读取链上状态':'等待 CSV 输入';
  for(const section of ['definition','execution','settlement']){ $(`code-${section}`).hidden=value!=='code';const csv=$(`csv-${section}`);if(csv)csv.hidden=value!=='csv';}
  $('scenario-code').classList.toggle('selected',value==='code');$('scenario-csv').classList.toggle('selected',value==='csv');
  $('task-id').textContent=value==='code'?'GITHUB / HSK':'CSV / LOCAL VERIFIER';$('task-title').textContent=value==='code'?'任务发布、交付与验证':'CSV 去重与文件验收';
  $('balance').textContent='—';$('balance-note').textContent=value==='code'?'尚未读取链上状态':'CSV 暂未接链上结算';
  $('pipeline').hidden=value==='csv';
}
$('scenario-code').onclick=()=>setScenario('code');$('scenario-csv').onclick=()=>setScenario('csv');
$('refresh').onclick=()=>operation(refresh);$('load-job').onclick=()=>operation(loadJob);
$('job-select').onchange=()=>operation(async()=>{const job=jobs.find(job=>String(job.jobId)===$('job-select').value);if(!job)return;$('job-id').value=job.jobId;$('pr-number').value=job.pr||'';$('submitted-sha').value=job.sha||'';invalidate();await loadJob();});
for(const id of ['pr-number','submitted-sha','job-id'])$(id).addEventListener('input',invalidate);
$('post').onclick=()=>operation(()=>preview({action:'post',issueUrl:$('issue-url').value,title:$('new-title').value,bounty:$('bounty').value,window:Math.round(Number($('hours').value)*3600)}));
for(const [id,action] of [['accept','accept'],['submit','submit'],['settle','settle']])$(id).onclick=()=>operation(()=>preview({action,jobId:jobId(),pr:$('pr-number').value}));
$('recover').onclick=()=>operation(()=>preview({action:$('recovery-action').value,jobId:jobId()}));
$('withdraw').onclick=()=>operation(()=>preview({action:'withdraw',role:'worker'}));
$('withdraw-requester').onclick=()=>operation(()=>preview({action:'withdraw',role:'requester'}));
$('read-pr').onclick=()=>operation(async()=>{const result=await api('/api/pr',{pr:$('pr-number').value});$('submitted-sha').value=result.headSha;invalidate();display(result);$('action-note').textContent='已读取真实 PR 身份，尚未验收或提交链上。';});
$('cancel-transaction').onclick=()=>{$('transaction-dialog').close();ticket=null;};
$('send-transaction').onclick=()=>operation(async()=>{
  if(!ticket)throw new Error('请重新生成预览');const current=ticket;ticket=null;$('send-transaction').disabled=true;$('transaction-dialog').close();
  const result=await api('/api/execute',{ticket:current});display(result);$('action-note').textContent='CLI 已返回交易结果，请核对回执与余额。';
  if(result.result.jobId)$('job-id').value=result.result.jobId;
  await refresh();if($('job-id').value)await loadJob();display(result);$('action-note').textContent='CLI 已返回交易结果，状态已重新读取。请核对交易回执；提现才会把可领取余额转入钱包。';
});
for(const id of ['csv-input','csv-key'])$(id).addEventListener('input',()=>{csvExpected=null;invalidate();});
$('csv-output').addEventListener('input',invalidate);
$('csv-run').onclick=()=>operation(async()=>{
  const result=await api('/api/csv',{action:'run',inputText:$('csv-input').value,key:$('csv-key').value});
  $('csv-output').value=result.outputText;csvExpected=result.expectedSha256;invalidate();display(result);$('status').textContent='已生成真实输出';$('action-note').textContent='已运行仓库参考执行器并固定预期哈希。可检查输出，或替换为外部输出后验收。';
});
$('verify').onclick=()=>operation(async()=>{
  invalidate();let result;
  try {
    if(scenario==='code')result=await api('/api/verify',{pr:$('pr-number').value,sha:$('submitted-sha').value});
    else {if(!csvExpected)throw new Error('先执行 CSV 去重以固定本轮输入和预期哈希');result=await api('/api/csv',{action:'verify',inputText:$('csv-input').value,outputText:$('csv-output').value,key:$('csv-key').value,expectedSha:csvExpected});}
    display(result);evidence(result);$('status').textContent=result.verified||result.passed?'验收通过':'验收失败';$('action-note').textContent='验收结果来自真实接口，本操作不触发付款。';
  }catch(error){evidence({verified:false,error:error.message});throw error;}
});
$('download-output').onclick=()=>download('result.csv',$('csv-output').value,'text/csv;charset=utf-8');
$('download-receipt').onclick=()=>{if(receipt)download('verification-receipt.json',JSON.stringify(receipt,null,2),'application/json');};
operation(refresh);
