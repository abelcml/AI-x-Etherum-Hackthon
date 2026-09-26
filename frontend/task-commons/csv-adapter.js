/* Browser implementation of docs/execution-acceptance.md; no server or AI call. */
(function(root){
function parse(text){
 if(text.includes('"'))throw new Error('此演示仅支持不带引号的简单 CSV。');
 const lines=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\n+$/,'').split('\n');
 const header=lines.shift().split(',');
 if(!header.includes('id'))throw new Error('缺少 id 列');
 const rows=lines.map(x=>x.split(','));
 if(rows.some(r=>r.length!==header.length))throw new Error('CSV 列数不一致');
 return {header,rows};
}
const serial=x=>[x.header,...x.rows].map(r=>r.join(',')).join('\n')+'\n';
function run(text){const input=parse(text),col=input.header.indexOf('id'),seen=new Set();return serial({header:input.header,rows:input.rows.filter(r=>{if(seen.has(r[col]))return false;seen.add(r[col]);return true;})});}
async function hash(text){const bytes=new TextEncoder().encode(serial(parse(text)));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');}
async function verify(inputText,outputText,expectedHash){
 const a=parse(inputText),b=parse(outputText),ai=a.header.indexOf('id'),bi=b.header.indexOf('id');
 const source=new Set(a.rows.map(r=>r[ai])),ids=b.rows.map(r=>r[bi]),unique=new Set(ids),actual=await hash(outputText);
 const checks=[{name:'表头与顺序',passed:JSON.stringify(a.header)===JSON.stringify(b.header)},
 {name:'id 集合完整',passed:source.size===unique.size&&[...source].every(x=>unique.has(x))},
 {name:'id 无重复',passed:ids.length===unique.size},{name:'输出 SHA-256',passed:actual===expectedHash}];
 return {passed:checks.every(x=>x.passed),checks,outputSha256:actual,expectedSha256:expectedHash};
}
root.CsvAdapter={run,hash,verify};
})(globalThis);
