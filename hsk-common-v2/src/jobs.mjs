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

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createTaskSpec({ chainId = 133, market, type, input, verification, title, bounty, window }) {
  if (!/^0x[a-f0-9]{40}$/i.test(market ?? '')) throw new Error('任务需要有效的 market 地址');
  if (!title?.trim()) throw new Error('任务标题不能为空');
  const bountyUnits = BigInt(bounty);
  const windowSeconds = Number(window);
  if (bountyUnits <= 0n) throw new Error('赏金必须大于 0');
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) throw new Error('交付期限必须是正整数秒');

  let taskInput;
  let policy;
  if (type === 'github-pr') {
    if (!REPO_PATTERN.test(input?.repo ?? '') || !Number.isSafeInteger(Number(input?.issue)) || Number(input.issue) < 1) {
      throw new Error('GitHub 任务需要 repo 和正整数 issue');
    }
    const appId = Number(verification?.appId);
    const requiredChecks = verification?.requiredChecks;
    if (!Number.isSafeInteger(appId) || appId < 1 || !Array.isArray(requiredChecks) || requiredChecks.length < 1 || requiredChecks.length > 20
      || requiredChecks.some((name) => typeof name !== 'string' || !name.trim() || name !== name.trim())
      || new Set(requiredChecks).size !== requiredChecks.length) {
      throw new Error('GitHub 任务需要有效的 App ID 和 1–20 个不重复的必需检查名');
    }
    const forbiddenPaths = verification?.forbiddenPaths ?? [];
    if (!Array.isArray(forbiddenPaths) || forbiddenPaths.some((path) => typeof path !== 'string' || !path || path !== path.trim() || path.startsWith('/'))
      || new Set(forbiddenPaths).size !== forbiddenPaths.length) {
      throw new Error('禁止修改路径必须是不重复的相对路径前缀');
    }
    taskInput = { repo: input.repo.toLowerCase(), issue: Number(input.issue) };
    policy = { appId, requiredChecks: [...requiredChecks], forbiddenPaths: [...forbiddenPaths] };
  } else if (type === 'csv-dedupe') {
    if (!SHA256_PATTERN.test(input?.inputSha256 ?? '') || !SHA256_PATTERN.test(input?.expectedSha256 ?? '') || typeof input?.key !== 'string' || !input.key.trim()) {
      throw new Error('CSV 任务需要 inputSha256、expectedSha256 和 key');
    }
    if (verification?.rule !== 'csv-dedupe-v1') throw new Error('CSV 任务需要 csv-dedupe-v1 验收规则');
    taskInput = { inputSha256: input.inputSha256.toLowerCase(), key: input.key.trim(), expectedSha256: input.expectedSha256.toLowerCase() };
    policy = { rule: 'csv-dedupe-v1' };
  } else {
    throw new Error(`不支持的任务类型：${type}`);
  }

  return {
    version: 2,
    chainId: Number(chainId),
    market: market.toLowerCase(),
    type,
    input: taskInput,
    verification: policy,
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
    const record = JSON.parse(await readFile(path, 'utf8'));
    if (BigInt(record.jobId) !== BigInt(jobId)) throw new Error('任务编号与本地记录不一致');
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`本地找不到任务 ${jobId} 的 GitHub 绑定记录；请在发布任务的目录中运行，或补齐 .data/jobs/${jobId}.json`);
    throw new Error(`读取任务记录失败：${error.message}`);
  }
}

export function recordMatchesChain(record, job, { chainId, market }) {
  const expected = record.spec?.version === 2
    ? createTaskSpec({ ...record.spec, chainId, market })
    : createJobSpec({ ...record.spec, chainId, market });
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
