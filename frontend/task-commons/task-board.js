'use strict';
// Fixtures are deliberately local. Replace this adapter after agreeing the team API.
const fixtures = {
 code:{id:'DEMO-CODE-001',name:'代码修复',subtitle:'GitHub 适配场景',title:'修复购物车折扣的金额精度错误',tags:['code-fix','Python','PR + CI'],brief:'订单小计为 19.99，打 9 折后出现长小数。修复金额精度，保留现有函数接口，并补充边界测试。',budget:30,hours:4,price:24,pricing:'基础 12 + 修复 8 + 测试 4',agent:'Code Worker · 模拟执行器',kind:'同版代码检查 + 人工合并',version:'demo-code-v2',criteria:['函数接口保持不变，金额保留两位小数','必要检查 unit-tests 与 interface-check 均通过','测试证据对应当前 PR head 版本','维护者人工认可并模拟合并后方可结算'],steps:['读取样例 issue.md 与 pricing.py','播放修复步骤：Decimal 运算及两位小数舍入','载入预设补丁和测试证据；等待验收'],files:[{name:'issue.md',role:'input',content:'# DEMO ISSUE · 虚构问题\n19.99 × 0.9 应输出 17.99。\n要求：不改变 discounted_total(price, discount) 接口。\n验收：单元测试、接口检查、当前 head 版本一致。\n本资料未关联任何真实 GitHub Issue。'},{name:'pricing.py',role:'input',content:'def discounted_total(price, discount):\n    return price * (1 - discount)\n\n# 示例输入：price=19.99, discount=0.1'},{name:'fix.patch',role:'output',content:'# PRESET DEMO PATCH · 未执行或推送\n+ from decimal import Decimal, ROUND_HALF_UP\n  def discounted_total(price, discount):\n-     return price * (1 - discount)\n+     result = Decimal(str(price)) * (1 - Decimal(str(discount)))\n+     return result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)'},{name:'checks.json',role:'evidence',content:JSON.stringify({simulated:true,delivery_version:'demo-code-v2',required_checks:[{name:'unit-tests',status:'success',version:'demo-code-v2'},{name:'interface-check',status:'success',version:'demo-code-v2'}],merged:false,note:'预设证据，不是实际 CI 执行结果；无真实 SHA / PR'},null,2)}],checks:[['unit-tests','金额边界测试通过','样例记录：success'],['interface-check','函数签名保持不变','样例记录：success'],['版本一致性','必要检查与交付版本相同','demo-code-v2'],['维护者认可','人工审核并模拟合并','等待人工操作']]},
 csv:{id:'DEMO-DATA-002',name:'CSV 清洗',subtitle:'文件交付场景',title:'清理客户列表中的重复记录与无效邮箱',tags:['data-cleaning','CSV','文件验收'],brief:'按规范化后的 email 去重，去除缺失或无效邮箱，保留每个邮箱的第一条记录。输出清洗 CSV 和逐条剔除原因。',budget:20,hours:2,price:15,pricing:'基础 8 + 去重 4 + 报告 3',agent:'Data Worker · 模拟执行器',kind:'文件结构 + 数据规则 + 人工认可',version:'demo-csv-v2',criteria:['输出列固定为 id、name、email','邮箱去除首尾空格并转为小写，去重保留首条','剔除空邮箱和无效格式，并给出原因','有效输出 2 行，剔除原因报告 3 行'],steps:['读取内置 customers.csv：5 行模拟记录','播放处理步骤：规范化、去重、校验邮箱','载入预设 clean.csv 与 rejected.csv；等待验收'],files:[{name:'customers.csv',role:'input',content:'id,name,email\n1,Alice, Alice@Example.com \n2,Bob,bob@example.com\n3,Alice Duplicate,alice@example.com\n4,Carol,\n5,Dan,not-an-email'},{name:'clean.csv',role:'output',content:'id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com'},{name:'rejected.csv',role:'output',content:'id,reason\n3,duplicate_normalized_email\n4,missing_email\n5,invalid_email_format'},{name:'checks.json',role:'evidence',content:JSON.stringify({simulated:true,delivery_version:'demo-csv-v2',input_rows:5,output_rows:2,rejected_rows:3,required_checks:['schema','unique_valid_email','row_accounting'],note:'预设交付资料，未运行远程 Agent'},null,2)}],checks:[['文件结构','id / name / email 三列','样例 clean.csv：3 列'],['数据规则','无重复或无效邮箱','样例 clean.csv：2 行有效记录'],['数量守恒','5 输入 = 2 输出 + 3 剔除','样例 rejected.csv：3 行原因'],['版本一致性','证据与交付版本一致','demo-csv-v2'],['人工认可','核对交付及剔除原因','等待人工操作']]},
 translation:{id:'DEMO-DOC-003',name:'文档翻译',subtitle:'人工审核场景',title:'将设备维护说明译成英文并保留安全提示',tags:['translation','文档','人工审阅'],brief:'将三段设备维护说明译为英文，保留原段落编号和全部安全提示。术语“断电”统一译为 disconnect the power supply。',budget:18,hours:3,price:12,pricing:'基础 6 + 三段翻译 3 + 术语核对 3',agent:'Language Worker · 模拟执行器',kind:'结构检查 + 术语核对 + 人工审阅',version:'demo-doc-v2',criteria:['保留 1、2、3 三个段落编号','完整保留断电和禁止湿手操作的安全提示','“断电”使用指定英文术语','语义准确性由人审核，结构通过不等于翻译正确'],steps:['读取 maintenance-zh.md 与 glossary.csv','播放翻译步骤：保留编号和安全提示','载入预设英文译文；语义准确性等待人工审阅'],files:[{name:'maintenance-zh.md',role:'input',content:'1. 维护前务必断电。\n2. 禁止用湿手接触电气端子。\n3. 每周检查传感器接线是否松动。'},{name:'glossary.csv',role:'input',content:'zh,en\n断电,disconnect the power supply\n电气端子,electrical terminals\n传感器,sensor'},{name:'maintenance-en.md',role:'output',content:'1. Always disconnect the power supply before maintenance.\n2. Do not touch electrical terminals with wet hands.\n3. Check the sensor wiring for loose connections every week.'},{name:'checks.json',role:'evidence',content:JSON.stringify({simulated:true,delivery_version:'demo-doc-v2',paragraphs:3,safety_notices_present:true,glossary_term_present:true,semantic_review:'requires_human',note:'结构与术语证据为样例，不是翻译质量保证'},null,2)}],checks:[['段落结构','保留 3 个编号段落','样例译文：1 / 2 / 3'],['安全与术语','两项安全提示及指定术语存在','样例记录：存在'],['版本一致性','证据与交付版本一致','demo-doc-v2'],['人工语义审阅','核对含义和安全提示无遗漏','等待人工操作']]}
};

// Align with the team's S packages; M pricing remains a reference, not a claim of integration.
delete fixtures.translation;
Object.assign(fixtures.code,{budget:2,price:2,hours:30,pricing:'code-fix/S · 最多修改 1 个文件 · 30 分钟',tags:['code-fix','size=S','deliverable=pr','verify=deterministic','window=30m']});
fixtures.code.brief='修复购物车折扣金额精度。已有失败测试；只允许修改 pricing.py，不修改 tests/ 或 .github/。';
fixtures.code.criteria=['已有失败测试；仅允许修改 1 个实现文件','不得修改 tests/ 与 .github/；路径约束尚未接入核心验收','指定 GitHub App 的必要检查必须全部通过且对应同一 head SHA','维护者合并；发布者批准后记为可领取，提现后到账'];
fixtures.code.checks.splice(2,0,['检查来源','指定 GitHub App','样例来源；真实 App ID 待配置']);
Object.assign(fixtures.csv,{title:'按 id 去重 sample.csv，保留第一次出现的记录',brief:'保持原表头、字段顺序与行顺序；同一 id 保留首次出现的记录，不得删掉任何唯一 id。',budget:0.5,price:0.5,hours:10,pricing:'csv-dedupe/S · ≤ 1,000 行 · 10 分钟',tags:['csv-dedupe','size=S','deliverable=csv','verify=deterministic','window=10m'],agent:'CSV 浏览器执行器 · 本地真实计算',kind:'四项确定性检查 + SHA-256',
criteria:['表头与输入的字段及顺序相同','输出 id 集合等于输入，不能乱删行','输出 id 不重复，保留第一次出现的记录','规范化 LF 换行后 SHA-256 等于预先公布值'],
steps:['读取团队 sample.csv：8 行输入','按 id 保留第一条并保持原顺序','在浏览器生成 result.csv；待执行四项真实验收'],
files:[{name:'sample.csv',role:'input',content:"id,name,city\n1,Alice,Sydney\n2,Bob,Melbourne\n1,Alice Dup,Perth\n3,Carol,Brisbane\n2,Bob Dup,Hobart\n4,Dave,Adelaide\n3,Carol Dup,Darwin\n5,Eve,Canberra\n"},{name:'result.csv',role:'output',content:''},{name:'acceptance.json',role:'evidence',content:'等待实际检查'}],
checks:[['表头与顺序','与输入完全相同','待计算'],['id 集合完整','保留全部 5 个唯一 id','待计算'],['id 无重复','每个 id 只保留一次','待计算'],['输出 SHA-256','等于事先固定的标准结果 hash','待计算'],['人工认可','核对结果后允许模拟结算','待人工']]});
const expectedCsvHash='bfe13e8e1f31c746f933354a6f3e33190397c9e664cb896d9db5bcb1fefa0173';

const labels={draft:'草稿',funded:'模拟已托管',running:'模拟执行中',submitted:'等待验收',verified:'等待人工认可',accepted:'可模拟结算',paid:'模拟可领取',withdrawn:'模拟已提现',refunded:'模拟已退款',disputed:'争议待处理'};
const phases=['任务定义','赏金托管','Agent 执行','交付验收','人工认可','结算','提现'];
const $=id=>document.getElementById(id);
const storageKey='task-commons-preview-v2';
let active='code', states={}, timer=null, selectedFile=0;
const fresh=k=>({status:'draft',brief:fixtures[k].brief,budget:fixtures[k].budget,hours:fixtures[k].hours,events:[],step:0,branch:'pass',checked:false,approved:false});
try { const saved=JSON.parse(localStorage.getItem(storageKey)||'null'); if(saved?.schema===1){active=fixtures[saved.active]?saved.active:'code';for(const k of Object.keys(fixtures)){const s=saved.states?.[k];if(s&&labels[s.status]&&Array.isArray(s.events)&&Number.isInteger(s.step)&&s.step>=0&&s.step<=3&&['pass','fail','stale','missing'].includes(s.branch))states[k]=s;}} }catch{}
for(const k of Object.keys(fixtures))states[k]??=fresh(k);
const data=()=>fixtures[active], state=()=>states[active];
function save(){try{localStorage.setItem(storageKey,JSON.stringify({schema:1,active,states}));}catch{$('action-note').textContent='浏览器无法保存草稿；本轮可继续，刷新后可能丢失。';}}
function log(text){state().events.push({time:new Date().toLocaleTimeString('zh-CN',{hour12:false}),text});}
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function download(name,content,type='text/plain'){const url=URL.createObjectURL(new Blob([content],{type:type+';charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function stop(){if(timer){clearTimeout(timer);timer=null;}}
function note(text){$('action-note').textContent=text;}
function render(){
 const d=data(),s=state();
 $('scenarios').replaceChildren(...Object.entries(fixtures).map(([k,f])=>{const b=el('button',f.name,k===active?'selected':'');b.append(el('small',f.subtitle));b.setAttribute('aria-pressed',String(k===active));b.onclick=()=>{stop();active=k;selectedFile=0;save();render();};return b;}));
 $('task-id').textContent=d.id+' / '+d.version+' / 模拟资料';$('task-title').textContent=d.title;$('tags').replaceChildren(...d.tags.map(t=>el('span',t.startsWith('window=')?'window='+s.hours+'m':t)));$('status').textContent=labels[s.status];
 const phase={draft:0,funded:1,running:2,submitted:3,verified:4,accepted:4,paid:5,withdrawn:6,refunded:5,disputed:3}[s.status];
 $('pipeline').replaceChildren(...phases.map((p,i)=>{const n=el('li',undefined,i===phase?'current':i<phase?'done':'');n.append(el('b',String(i+1)),document.createTextNode(p));return n;}));
 $('brief').value=s.brief;$('budget').value=s.budget;$('deadline').value=s.hours;
 for(const id of ['brief','budget','deadline'])$(id).disabled=s.status!=='draft';
 $('inputs').replaceChildren(...d.files.filter(f=>f.role==='input').map(f=>{const n=el('div',undefined,'file-item');n.append(el('span','FILE'),document.createTextNode(f.name));return n;}));
 $('criteria').replaceChildren(...d.criteria.map(c=>el('li',c)));
 $('quote').textContent=d.price+' tUSDC';$('pricing').textContent=d.pricing.replace(/\d+ 分钟/,s.hours+' 分钟');
 const valid=(Number.isFinite(s.budget)&&s.budget>0)&&s.budget>=d.price&&s.budget<=10000&&Number.isInteger(s.hours)&&s.hours>=10&&s.hours<=10080&&s.brief.trim().length>0;
 $('budget-note').textContent=valid?'预算可覆盖报价；托管金额按报价 '+d.price+' 计算。':'请输入有效说明、10–10080 分钟期限，以及不低于报价的整数预算。';
 $('fund').disabled=s.status!=='draft'||!valid;
 $('agent').textContent=d.agent;$('execution-caption').textContent=active==='csv'?'本机浏览器真实去重 · 无 AI 调用':'预设步骤播放 · 无真实 Agent 接单';$('agent-state').textContent=s.status==='running'?(timer?'播放中':'已暂停'):s.step===3?'样例已交付':'等待任务';
 $('run').disabled=!['funded','running'].includes(s.status)||!!timer;$('run').textContent=active==='csv'?(s.step>0?'继续本地处理':'运行本地 CSV 处理'):(s.step>0?'继续模拟执行':'播放模拟执行');$('pause').disabled=!timer;
 $('events').replaceChildren(...(s.events.length?s.events.map(e=>{const n=el('li');n.append(el('time',e.time),el('span',e.text));return n;}):[el('li','等待发布任务。这里将显示你触发的模拟动作。','empty')]));$('events').scrollTop=$('events').scrollHeight;
 if(active==='csv'&&s.step===3){d.files[1].content=CsvAdapter.run(d.files[0].content);if(s.csvResult)d.files[2].content=JSON.stringify(s.csvResult,null,2);}const files=d.files.filter(f=>f.role==='input'||s.step===3);if(selectedFile>=files.length)selectedFile=0;
 $('file-tabs').replaceChildren(...files.map((f,i)=>{const b=el('button',f.name,i===selectedFile?'selected':'');b.onclick=()=>{selectedFile=i;render();};return b;}));
 $('file-preview').textContent=files[selectedFile].content;$('file-caption').textContent=files[selectedFile].role==='input'?'内置模拟输入，可下载核对。':(active==='csv'?'本地计算的结果与验收证据；未上链。':'预先编写的交付样例；不是刚刚由 Agent 生成或执行的结果。');
 $('download-file').onclick=()=>download(files[selectedFile].name,files[selectedFile].content);
 $('escrow').textContent=['draft','paid','withdrawn','refunded'].includes(s.status)?'0':String(d.price);
 $('escrow-note').textContent=s.status==='paid'?'已模拟记入可领取余额 '+d.price+' tUSDC；仍需提现':s.status==='withdrawn'?'模拟提现完成；无链上交易':s.status==='refunded'?'模拟账目：已退还 '+d.price+'；无链上交易':s.status==='draft'?'尚未托管 · 无实际资产':'浏览器内模拟记录 · 未锁定任何链上资产';
 $('verification-kind').textContent=d.kind;$('branch').value=s.branch;$('branch').disabled=['accepted','paid','withdrawn','refunded','disputed'].includes(s.status);
 $('verify').disabled=!['submitted','verified'].includes(s.status);$('approve').disabled=s.status!=='verified';$('approve').textContent=active==='code'?'人工认可并模拟合并':'人工认可本轮交付';$('pay').disabled=s.status!=='accepted';$('withdraw').disabled=s.status!=='paid';$('claimable').textContent=s.status==='paid'?String(d.price)+' tUSDC':'0 tUSDC';
 $('timeout').disabled=!['funded','running','submitted','verified'].includes(s.status);$('dispute').disabled=!['submitted','verified','accepted'].includes(s.status);
 let statusText='先发布模拟任务，再播放执行步骤。';
 if(s.status==='funded')statusText='托管为模拟记录。可播放执行步骤，或模拟到期退款。';
 if(s.status==='running')statusText=timer?'正在播放内置步骤，不调用外部 Agent。':'播放已暂停；点击继续，不会丢失本轮进度。';
 if(s.status==='submitted')statusText=s.checked?'验收被拦截。切换情形可重新核对；也可标记争议。':'样例成果已展示。选择一种情形，检查模拟验收资料。';
 if(s.status==='verified')statusText='样例必要检查均满足条件，仍需人工认可交付。';
 if(s.status==='accepted')statusText='人工认可已记录，可预览发放结果；不会触发钱包或链上交易。';
 if(s.status==='paid')statusText='模拟结算已记入可领取余额；请再点击模拟提现，不代表实际到账。';
 if(s.status==='withdrawn')statusText='模拟提现完成；无钱包签名或真实交易。';if(s.status==='refunded')statusText='已模拟“到期且允许退款”的情形，不以页面时钟判断合约期限。';
 if(s.status==='disputed')statusText='争议状态已标记。演示停止自动推进，处理规则待团队确认。';note(statusText);
 renderChecks();save();
}
function renderChecks(){const d=data(),s=state();$('checks').replaceChildren(...d.checks.map((r,i)=>{const tr=el('tr');let value=s.step===3?r[2]:'等待交付';let result='未检查',cls='pending';const last=i===d.checks.length-1;
 if(s.checked&&!last){result='满足（模拟）';cls='ok';if(s.branch==='fail'&&i===0){value='样例分支：必要检查失败';result='不满足';cls='bad';}if(s.branch==='missing'&&i===0){value='样例分支：未提供必要检查';result='证据缺失';cls='bad';}if(s.branch==='stale'&&r[0]==='版本一致性'){value=d.version.replace('v2','v1')+' ≠ '+d.version;result='版本不匹配';cls='bad';}}
 if(active==='csv'&&s.checked&&!last&&s.csvResult){const c=s.csvResult.checks[i];value=i===3?s.csvResult.outputSha256:(c.passed?'本地检查通过':'本地检查失败');result=c.passed?'通过（实算）':'不满足';cls=c.passed?'ok':'bad';}if(last){value=s.approved?'本轮已人工认可':'等待人工操作';result=s.approved?'已认可（模拟）':'待人工';cls=s.approved?'ok':'pending';}
 tr.append(el('td',r[0]),el('td',r[1]),el('td',value),el('td',result,cls));return tr;}));$('evidence-summary').textContent=!s.checked?'尚未检查':s.branch!=='pass'?'检查未满足 · 禁止结算':s.approved?'检查及人工认可完成':'检查满足 · 等待人工';}
function advance(){const s=state();if(s.status!=='running')return;s.step++;log('模拟执行 '+s.step+'/3：'+data().steps[s.step-1]);if(s.step===3){if(active==='csv')data().files[1].content=CsvAdapter.run(data().files[0].content);s.status='submitted';selectedFile=data().files.filter(f=>f.role==='input').length;timer=null;render();return;}timer=setTimeout(advance,1100);render();}
for(const id of ['brief','budget','deadline'])$(id).addEventListener('input',()=>{const s=state();if(s.status!=='draft')return;s.brief=$('brief').value;s.budget=Number($('budget').value);s.hours=Number($('deadline').value);const valid=(Number.isFinite(s.budget)&&s.budget>0)&&s.budget>=data().price&&s.budget<=10000&&Number.isInteger(s.hours)&&s.hours>=10&&s.hours<=10080&&s.brief.trim().length>0;$('fund').disabled=!valid;$('budget-note').textContent=valid?'预算可覆盖报价；托管金额按报价 '+data().price+' 计算。':'预算需覆盖报价，期限为 10–10080 的整数，说明不能为空。';save();});
 $('fund').onclick=()=>{if($('fund').disabled)return;state().status='funded';log('模拟发布任务；按样例报价托管 '+data().price+' 测试 tUSDC。无链上交易。');render();};
 $('run').onclick=()=>{if($('run').disabled)return;state().status='running';log(state().step?'继续播放模拟步骤。':'开始播放预设步骤；未启动真实 Agent。');timer=setTimeout(advance,650);render();};
 $('pause').onclick=()=>{stop();log('已暂停播放。');render();};
 $('branch').onchange=()=>{delete state().csvResult;state().branch=$('branch').value;state().checked=false;state().approved=false;if(state().status==='verified')state().status='submitted';render();};
 $('verify').onclick=async()=>{
 if($('verify').disabled)return;
 const key=active,s=state(),d=data();$('verify').disabled=true;
 try{
  let passed=s.branch==='pass';
  if(key==='csv'){
   let output=CsvAdapter.run(d.files[0].content);
   if(s.branch==='fail')output=output.split('\n').slice(0,-2).join('\n')+'\n';
   if(s.branch==='missing')output='id,name,city\n';
   if(s.branch==='stale')output=output.replace('Alice','Old Alice');
   const result=await CsvAdapter.verify(d.files[0].content,output,expectedCsvHash);
   if(active!==key||state()!==s)return;
   s.csvResult={...result,checkedOutput:output,mode:'browser_computation',branch:s.branch};passed=result.passed;
  }
  s.checked=true;s.approved=false;s.status=passed?'verified':'submitted';
  log((key==='csv'?'真实 CSV 验收：':'模拟 GitHub 验收：')+(passed?'条件满足，等待人工认可。':'检查不满足，禁止结算。'));
  render();
 }catch(e){if(active===key&&state()===s){s.checked=false;render();note('验收失败：'+e.message);}}
 };
 $('approve').onclick=()=>{if($('approve').disabled)return;state().approved=true;state().status='accepted';log(active==='code'?'人工认可并模拟合并；未向 GitHub 提交操作。':'已人工认可样例交付。');render();};
 $('pay').onclick=()=>{if($('pay').disabled)return;state().status='paid';log('模拟批准结算，可领取 '+data().price+' tUSDC；未生成交易，未调用钱包。');render();};
 $('withdraw').onclick=()=>{if($('withdraw').disabled)return;state().status='withdrawn';log('模拟执行 worker withdraw；无链上交易。');render();};
 $('timeout').onclick=()=>{if($('timeout').disabled)return;stop();state().status='refunded';log('注入到期可退款情形，模拟退还赏金。不是实际合约退款。');render();};
 $('dispute').onclick=()=>{if($('dispute').disabled)return;stop();state().status='disputed';log('人工标记争议；暂停结算，等待约定处理规则。');render();};
 $('reset').onclick=()=>{stop();states[active]=fresh(active);selectedFile=0;render();};
 $('export').onclick=()=>{const d=data(),s=state();download(d.id+'.json',JSON.stringify({schema_version:1,mode:'frontend_simulation',task_id:d.id,title:d.title,description:'[labels] type='+d.tags[0]+' size=S deliverable='+(active==='code'?'pr':'csv')+' verify=deterministic window='+s.hours+'m\n'+s.brief,tags:d.tags,budget:s.budget,currency:'MockUSDC',decimals:6,deliveryWindow:s.hours*60,pricingMode:'test-package',fees:'read postCost from contract when connected',workerBond:'read bondFor from contract when connected',quoted_amount:d.price,acceptance_criteria:d.criteria,delivery_version:d.version,files:d.files,preview_state:s,chain:{target_chain_id:133,connected:false,contract_address:null,transaction_hash:null},integration_note:'Proposed frontend data shape only; not an agreed team backend API.'},null,2),'application/json');};
window.addEventListener('pagehide',()=>{stop();save();});render();
