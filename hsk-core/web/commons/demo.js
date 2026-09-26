const EXPLORER = 'https://testnet-explorer.hskchain.net/tx/';
const SAMPLE_CSV = 'id,name,city\n1,Alice,Sydney\n2,Bob,Melbourne\n1,Alice Dup,Perth\n3,Carol,Brisbane\n2,Bob Dup,Hobart\n4,Dave,Adelaide\n3,Carol Dup,Darwin\n5,Eve,Canberra\n';
const $ = (id) => document.getElementById(id);
let csrf = '';

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-commons-csrf': csrf },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderChecks(list) {
  return '<ul class="checks">' + list.map(({ label, ok }) =>
    `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${label}</li>`).join('') + '</ul>';
}

async function run(button, out, task) {
  button.disabled = true;
  out.innerHTML = '<p class="muted">讀取中…</p>';
  try { out.innerHTML = await task(); }
  catch (error) { out.innerHTML = `<p class="bad">錯誤：${esc(error.message)}</p>`; }
  finally { button.disabled = false; }
}

$('loadJob').onclick = () => run($('loadJob'), $('jobOut'), async () => {
  const id = $('jobIdInput').value;
  const job = (await api(`/api/jobs/${encodeURIComponent(id)}`)).result;
  const record = (await api('/api/jobs')).jobs.find((j) => j.jobId === String(id));
  const links = record ? [['發布', record.postedTx], ['提交', record.submittedTx]]
    .filter(([, tx]) => tx).map(([name, tx]) => `<a href="${EXPLORER + tx}" target="_blank" rel="noopener">${name} tx ↗</a>`).join(' · ') : '';
  return `<p class="big">${esc(job.status)}</p>
    <p>賞金 ${esc(job.bounty)}${record ? ` · Issue #${esc(record.issue)}${record.pr ? ` · PR #${esc(record.pr)}` : ''}` : ''}</p>
    <p class="mono">鏈上 resultHash：${esc(job.resultHash)}</p>
    <p>${links}</p>`;
});

$('verifyPr').onclick = () => run($('verifyPr'), $('prOut'), async () => {
  const pr = Number($('prInput').value);
  const identity = await api('/api/pr', { pr });
  const v = await api('/api/verify', { pr, sha: identity.headSha });
  const sameCommit = v.pr_head_sha && v.pr_head_sha === v.ci_sha;
  const checks = (v.checks || []).map((c) => `${c.name} = ${c.conclusion}`).join(', ') || '無';
  return renderChecks([
    { label: 'PR 已 merge', ok: v.merged === true },
    { label: `CI 驗的 commit = 被 merge 的 commit（<span class="mono">${esc((v.ci_sha || '').slice(0, 12))}</span>）`, ok: sameCommit },
    { label: `必需檢查全部通過（${esc(checks)}）`, ok: v.all_checks_passed === true },
    { label: `結果指紋 resultHash：<span class="mono">${esc(v.result_hash || '—')}</span>`, ok: v.verified === true },
  ]) + `<p class="big ${v.verified ? 'ok' : 'bad'}">${v.verified ? '驗收通過：可以結算' : '驗收不通過：不能付款'}</p>`;
});

async function csvCheck(dropRow) {
  const ran = await api('/api/csv', { action: 'run', inputText: SAMPLE_CSV, key: 'id' });
  let output = ran.outputText;
  if (dropRow) output = output.split('\n').filter((line) => !line.startsWith('5,')).join('\n');
  const v = await api('/api/csv', { action: 'verify', inputText: SAMPLE_CSV, outputText: output, key: 'id', expectedSha: ran.expectedSha256 });
  const failed = (rule) => (v.reasons || []).some((r) => r.startsWith(rule));
  return `<p class="muted">輸入 ${ran.inputRows} 列（含重複 id），${dropRow ? '交付時故意刪掉 id=5 那一列' : '交付正確的去重結果'}</p>` + renderChecks([
    { label: '規則 1：表頭與輸入相同', ok: !failed('rule 1') },
    { label: '規則 2：id 一個都沒少', ok: !failed('rule 2') },
    { label: '規則 3：沒有重複 id', ok: !failed('rule 3') },
    { label: '規則 4：輸出 hash = 預期答案', ok: !failed('rule 4') },
  ]) + `<p class="big ${v.passed ? 'ok' : 'bad'}">${v.passed ? '驗收通過' : '驗收不通過：不能付款'}</p>`;
}
$('csvGood').onclick = () => run($('csvGood'), $('csvOut'), () => csvCheck(false));
$('csvBad').onclick = () => run($('csvBad'), $('csvOut'), () => csvCheck(true));

api('/api/config').then((c) => { csrf = c.csrf; }).catch((e) => {
  document.querySelector('.sub').innerHTML = `<span class="bad">無法連到伺服器：${esc(e.message)}</span>`;
});
