import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { formatUnits, keccak256, toBytes } from 'viem';

export const JOB_STATUS = Object.freeze({
  Open: 0,
  Accepted: 1,
  Submitted: 2,
  Completed: 3,
  Cancelled: 4,
  Disputed: 5,
  Refunded: 6,
  Expired: 7,
});

export const ERC20_ABI = [
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
];

const STATUS_NAME = Object.fromEntries(Object.entries(JOB_STATUS).map(([name, value]) => [value, name]));
const JOB_FIELDS = [
  'requester', 'worker', 'bounty', 'minScore', 'status', 'specHash', 'resultHash',
  'openDeadline', 'deliveryDeadline', 'reviewDeadline', 'disputeDeadline',
  'deliveryWindow', 'payee', 'payeeAmount',
];

export function normalizeJob(value) {
  if (!value) throw new Error('链上没有返回任务数据');
  const job = {};
  for (let index = 0; index < JOB_FIELDS.length; index += 1) {
    const key = JOB_FIELDS[index];
    job[key] = value[key] ?? value[index];
  }
  if (job.status === undefined || job.requester === undefined) throw new Error('无法解析链上任务结构');
  job.status = Number(job.status);
  return job;
}

export function statusName(status) {
  return STATUS_NAME[Number(status)] ?? `Unknown(${status})`;
}

export function createJobSpec({ chainId = 133, market, repo, issue, title, bounty, window }) {
  if (!market || !repo || !Number.isSafeInteger(Number(issue)) || Number(issue) <= 0) {
    throw new Error('任务需要 market、GitHub repo 和正整数 issue');
  }
  if (!title?.trim()) throw new Error('任务标题不能为空');
  const bountyUnits = BigInt(bounty);
  const windowSeconds = Number(window);
  if (bountyUnits <= 0n) throw new Error('赏金必须大于 0');
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) throw new Error('交付期限必须是正整数秒');
  return {
    version: 1,
    chainId: Number(chainId),
    market: market.toLowerCase(),
    repo: repo.toLowerCase(),
    issue: Number(issue),
    title: title.trim(),
    bounty: bountyUnits.toString(),
    window: windowSeconds,
  };
}

export function hashJobSpec(spec) {
  // Explicit key order in createJobSpec makes the commitment stable across runs.
  return keccak256(toBytes(JSON.stringify(spec)));
}

export function assertJobStatus(job, expected, action) {
  if (job.status !== expected) {
    throw new Error(`${action} 要求任务状态 ${statusName(expected)}，当前为 ${statusName(job.status)}`);
  }
}

export function assertAddressMatches(actual, expected, message) {
  if (!actual || !expected || actual.toLowerCase() !== expected.toLowerCase()) throw new Error(message);
}

export function formatToken(amount, decimals = 6) {
  return `${formatUnits(BigInt(amount), decimals)} USDC`;
}

export function jobFilePath(jobId, root = process.cwd()) {
  return join(root, '.data', 'jobs', `${BigInt(jobId)}.json`);
}

export async function saveJobRecord(record, root = process.cwd()) {
  const path = jobFilePath(record.jobId, root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  return path;
}

export async function loadJobRecord(jobId, root = process.cwd()) {
  const path = jobFilePath(jobId, root);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`本地找不到任务 ${jobId} 的 GitHub 绑定记录；请在发布任务的目录中运行，或补齐 .data/jobs/${jobId}.json`);
    throw new Error(`读取任务记录失败：${error.message}`);
  }
}

export function recordMatchesChain(record, job, { chainId, market }) {
  const expected = createJobSpec({ ...record.spec, chainId, market });
  return hashJobSpec(expected).toLowerCase() === String(job.specHash).toLowerCase();
}

export function parseCliArgs(argv) {
  if (!argv.length) throw new Error('缺少命令');
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--send') {
      options.send = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`无法识别参数：${arg}`);
    const key = arg.slice(2);
    if (!key || options[key] !== undefined) throw new Error(`参数重复或为空：${arg}`);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 缺少取值`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

export function requireOptions(options, keys) {
  for (const key of keys) {
    if (options[key] === undefined || options[key] === '') throw new Error(`缺少 --${key}`);
  }
}

export function stringifyJob(job, id, decimals = 6) {
  return {
    jobId: String(id),
    status: statusName(job.status),
    requester: job.requester,
    worker: job.worker,
    bounty: formatToken(job.bounty, decimals),
    specHash: job.specHash,
    resultHash: job.resultHash,
    deliveryDeadline: String(job.deliveryDeadline),
    reviewDeadline: String(job.reviewDeadline),
  };
}
