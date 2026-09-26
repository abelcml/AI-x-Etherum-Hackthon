const $ = id => document.getElementById(id);
const labels = { open: '待接单', accepted: '进行中', submitted: '待结算', completed: '已领取' };
const initialTasks = () => [
  { id: 1, title: '修复钱包连接后的网络提示', issue: 'https://github.com/abelcml/AI-x-Etherum-Hackthon/issues', bounty: 12, window: 3600, status: 'open', type: '前端', description: '连接钱包后显示当前网络，网络不匹配时给出清晰提示。此任务为演示示例。' },
  { id: 2, title: 'CSV 去重：保留记录与验收报告', issue: 'https://github.com/abelcml/AI-x-Etherum-Hackthon/issues', bounty: 8, window: 7200, status: 'accepted', type: '数据处理', description: '按指定字段去重并输出处理摘要，展示非 GitHub 业务的任务形态。此任务为演示示例。' },
  { id: 3, title: '补充任务状态的边界测试', issue: 'https://github.com/abelcml/AI-x-Etherum-Hackthon/issues', bounty: 15, window: 3600, status: 'submitted', type: '测试', description: '检查异常状态和超时路径，提供可复核的测试结果。这里的验收结果均为模拟数据。' },
];
let tasks = initialTasks();
let selected = 1;
let toastTimer;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function render() {
  const query = $('search-input').value.trim().toLowerCase();
  const status = $('status-filter').value;
  const visible = tasks.filter(t => (status === 'all' || t.status === status) && `${t.title} ${t.type}`.toLowerCase().includes(query));
  $('stat-open').textContent = tasks.filter(t => t.status === 'open').length;
  $('stat-bounty').textContent = tasks.filter(t => t.status !== 'completed').reduce((sum, t) => sum + t.bounty, 0).toLocaleString();
  $('stat-completed').textContent = tasks.filter(t => t.status === 'completed').length;
  $('task-count').textContent = `${visible.length} 个任务`;
  if (!visible.some(t => t.id === selected)) selected = visible[0]?.id;
  $('task-list').innerHTML = visible.length ? visible.map(t => `<button class="task-card ${selected === t.id ? 'selected' : ''}" data-id="${t.id}" aria-pressed="${selected === t.id}"><span class="task-topline"><span class="task-meta">DEMO-${String(t.id).padStart(3, '0')}</span><span class="status-badge status-${t.status}">${labels[t.status]}</span></span><span class="task-title">${escape(t.title)}</span><span class="task-meta">示例任务 · ${t.window / 3600} 小时交付</span><span class="task-bottom"><span class="tag">${escape(t.type)}</span><span class="reward">${t.bounty} <small>MockUSDC</small></span></span></button>`).join('') : '<div class="empty-state"><h3>没有匹配的任务</h3><p>试试其他关键词或任务状态。</p></div>';
  renderDetail();
}
function renderDetail() {
  const task = tasks.find(t => t.id === selected);
  if (!task) { $('task-detail').innerHTML = '<div class="empty-state">选择一个任务查看详情</div>'; return; }
  const step = ['open', 'accepted', 'submitted', 'completed'].indexOf(task.status);
  const action = ['模拟接单', '模拟 PR 验收通过', '模拟结算并领取', '演示流程已完成'][step];
  $('task-detail').innerHTML = `<div class="detail-heading"><span class="eyebrow">TASK DETAILS</span><span class="status-badge status-${task.status}">${labels[task.status]}</span></div><h2>${escape(task.title)}</h2><p class="detail-body">${escape(task.description)}</p><div class="detail-grid"><div><span class="detail-label">任务奖励</span><strong class="detail-value">${task.bounty} <small>MockUSDC</small></strong></div><div><span class="detail-label">交付时限</span><strong class="detail-value">${task.window / 3600} 小时</strong></div></div><a class="issue-link" href="${escape(task.issue)}" target="_blank" rel="noopener noreferrer">查看 GitHub 需求 ↗</a><h3>执行进度</h3><ol class="flow">${['发布悬赏', '工作者接单', 'PR 验收', '结算与领取'].map((name,i)=>`<li class="flow-step ${i < step ? 'is-done' : ''} ${i === step ? 'is-current' : ''}"><span>${i < step ? '✓' : i + 1}</span><div>${name}<small>${i < step ? '演示步骤已完成' : i === step ? '当前阶段' : '等待前序步骤'}</small></div></li>`).join('')}</ol><div class="notice">演示模式 · 操作只改变当前页面，不读取真实 PR、不发送交易；刷新后重置。</div><div class="detail-actions"><button class="button button-primary" id="advance-task" ${step === 3 ? 'disabled' : ''}>${action}</button></div><p class="detail-footnote">真实流程中，结算与提现是两笔独立交易。</p>`;
  $('advance-task').addEventListener('click', () => {
    if (step === 3) return;
    task.status = ['accepted', 'submitted', 'completed'][step]; render(); toast('演示状态已更新，未发送任何交易。');
  });
}
$('task-list').addEventListener('click', e => { const card = e.target.closest('[data-id]'); if (card) { selected = Number(card.dataset.id); render(); } });
$('search-input').addEventListener('input', render);
$('status-filter').addEventListener('change', render);
$('new-task-button').addEventListener('click', () => $('task-dialog').showModal());
$('cancel-dialog').addEventListener('click', () => $('task-dialog').close());
$('reset-button').addEventListener('click', () => { tasks = initialTasks(); selected = 1; $('search-input').value = ''; $('status-filter').value = 'all'; render(); toast('已恢复示例任务。'); });
$('task-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  let url;
  try { url = new URL(data.get('issue')); if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !/^\/[^/]+\/[^/]+\/issues\/\d+\/?$/.test(url.pathname) || url.username || url.password) throw Error(); } catch { toast('请输入有效的 GitHub Issue 链接（含 Issue 编号）。'); return; }
  const bounty = Number(data.get('bounty')), window = Number(data.get('window'));
  const title = String(data.get('title')).trim();
  if (!title || !Number.isFinite(bounty) || bounty <= 0 || !Number.isInteger(window) || window < 600 || window > 86400) { toast('请填写任务名称、正数奖励和有效交付时限。'); return; }
  selected = Math.max(...tasks.map(t=>t.id)) + 1;
  tasks.unshift({ id:selected, title, issue:url.href, bounty, window, status:'open', type:'自定义', description:String(data.get('description') || '新建的本地演示任务，尚未上链。') });
  $('search-input').value = ''; $('status-filter').value = 'all'; $('task-dialog').close(); event.currentTarget.reset(); render(); toast('演示任务已创建，未存入任何奖励。');
});
let walletBusy = false;
async function updateWallet(accounts) {
  if (!accounts?.length) { $('wallet-button').textContent = '连接钱包'; $('wallet-status').textContent = '钱包未连接'; return; }
  const chainId = await window.ethereum.request({method:'eth_chainId'});
  $('wallet-button').textContent = `${accounts[0].slice(0,6)}…${accounts[0].slice(-4)}`;
  $('wallet-status').textContent = Number(chainId) === 133 ? 'HSK 测试网 · 已连接（页面仍为演示）' : '当前网络不是 HSK 测试网（133）';
}
$('wallet-button').addEventListener('click', async () => {
  if (walletBusy) return;
  if (!window.ethereum) { toast('未检测到浏览器钱包，请在装有钱包扩展的浏览器中打开。'); return; }
  walletBusy = true; $('wallet-button').disabled = true;
  try { await updateWallet(await window.ethereum.request({method:'eth_requestAccounts'})); }
  catch { toast('钱包连接未完成，可稍后重试。'); }
  finally { walletBusy = false; $('wallet-button').disabled = false; }
});
window.ethereum?.on?.('accountsChanged', accounts => updateWallet(accounts).catch(()=>toast('钱包状态更新失败。')));
window.ethereum?.on?.('chainChanged', () => window.ethereum.request({method:'eth_accounts'}).then(updateWallet).catch(()=>toast('网络状态更新失败。')));
render();

document.querySelectorAll('[data-dialog-close]').forEach(button => button.addEventListener('click', () => document.getElementById('task-dialog').close()));
