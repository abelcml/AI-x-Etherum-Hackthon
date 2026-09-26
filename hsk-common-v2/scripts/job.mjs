#!/usr/bin/env node
import {
  assertAddressMatches,
  assertJobStatus,
  createTaskSpec,
  hashJobSpec,
  loadJobRecord,
  normalizeJob,
  parseCliArgs,
  recordMatchesChain,
  requireOptions,
  saveJobRecord,
  stringifyJob,
  JOB_STATUS,
  ERC20_ABI,
} from '../src/jobs.mjs';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatUnits, parseEventLogs, parseUnits } from 'viem';
import { context, sendContract } from '../src/runtime.mjs';
import { getPrIdentity, verifyMergedPr } from '../src/github.mjs';
import { hashPrResult } from '../src/proof.mjs';
import { csvTaskInput, verifySubmission } from '../src/verify.mjs';

const usage = `
HSK testnet task CLI (all writes are dry-run unless --send is supplied)

  node scripts/job.mjs post --type github-pr --issue 12 --title "Fix parser" --bounty 1 --window 3600 [--send]
  node scripts/job.mjs post --type csv-dedupe --input sample.csv --key id --title "Dedupe CSV" --bounty 1 --window 3600 [--send]
  node scripts/job.mjs accept --job 1 [--send]
  node scripts/job.mjs submit --job 1 --pr 42 [--send]
  node scripts/job.mjs submit --job 2 --output deduped.csv [--send]
  node scripts/job.mjs settle --job 1 [--send]
  node scripts/job.mjs status --job 1
  node scripts/job.mjs cancel|reclaim|expire-open|expire-review --job 1 [--send]
  node scripts/job.mjs withdraw --role requester|worker [--send]

Required for GitHub actions: GITHUB_REPOSITORY, GITHUB_TOKEN,
GITHUB_CHECK_APP_ID and comma-separated GITHUB_REQUIRED_CHECKS.
`;

const MARKET_READ_ABI = [
  { type: 'function', name: 'jobs', stateMutability: 'view', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [{ name: 'job', type: 'tuple', components: [
    { name: 'requester', type: 'address' }, { name: 'worker', type: 'address' }, { name: 'bounty', type: 'uint256' },
    { name: 'minScore', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'specHash', type: 'bytes32' },
    { name: 'resultHash', type: 'bytes32' }, { name: 'openDeadline', type: 'uint64' }, { name: 'deliveryDeadline', type: 'uint64' },
    { name: 'reviewDeadline', type: 'uint64' }, { name: 'disputeDeadline', type: 'uint64' }, { name: 'deliveryWindow', type: 'uint32' },
    { name: 'payee', type: 'address' }, { name: 'payeeAmount', type: 'uint256' },
  ] }] },
  { type: 'function', name: 'postCost', stateMutability: 'view', inputs: [{ name: 'bounty', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'bondFor', stateMutability: 'view', inputs: [{ name: 'bounty', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'feeOn', stateMutability: 'view', inputs: [{ name: 'bounty', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'MIN_BOUNTY', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'MIN_DELIVERY_WINDOW', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'MAX_DELIVERY_WINDOW', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'withdrawable', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const ACTION_ABI = {
  postJob: [{ type: 'function', name: 'postJob', stateMutability: 'nonpayable', inputs: [{ name: 'bounty', type: 'uint256' }, { name: 'minScore', type: 'uint256' }, { name: 'specHash', type: 'bytes32' }, { name: 'deliveryWindow', type: 'uint32' }], outputs: [{ type: 'uint256' }] }],
  acceptJob: [{ type: 'function', name: 'acceptJob', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
  submitWork: [{ type: 'function', name: 'submitWork', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'resultHash', type: 'bytes32' }], outputs: [] }],
  approveJob: [{ type: 'function', name: 'approveJob', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
  cancelJob: [{ type: 'function', name: 'cancelJob', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
  reclaimJob: [{ type: 'function', name: 'reclaimJob', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
  expireOpen: [{ type: 'function', name: 'expireOpen', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
  expireReview: [{ type: 'function', name: 'expireReview', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] }],
  withdraw: [{ type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] }],
};

function repository() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) throw new Error('请设置 GITHUB_REPOSITORY=owner/repo');
  return repo.toLowerCase();
}

function githubVerificationSettings() {
  const appId = process.env.GITHUB_CHECK_APP_ID;
  const requiredChecks = (process.env.GITHUB_REQUIRED_CHECKS ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  if (!appId || !/^\d+$/.test(appId)) throw new Error('请设置有效的 GITHUB_CHECK_APP_ID');
  if (!requiredChecks.length) throw new Error('请设置 GITHUB_REQUIRED_CHECKS（逗号分隔）');
  return { appId: Number(appId), requiredChecks, token: process.env.GITHUB_TOKEN };
}

function assertHsk(ctx) {
  if (Number(ctx.chain?.id) !== 133) throw new Error(`此精简 CLI 只支持 HSK 测试网 133，当前为 ${ctx.chain?.id ?? 'unknown'}`);
}

async function readMarket(ctx, functionName, args = [], abi = MARKET_READ_ABI) {
  return ctx.publicClient.readContract({ address: ctx.market, abi, functionName, args });
}

async function getJob(ctx, id) {
  return normalizeJob(await readMarket(ctx, 'jobs', [BigInt(id)]));
}

async function send(ctx, functionName, args, abi = ACTION_ABI[functionName]) {
  const receipt = await sendContract(ctx, { address: ctx.market, abi, functionName, args });
  if (receipt?.status === 'reverted') throw new Error(`${functionName} 交易已回滚`);
  return receipt;
}

function txHash(receipt) {
  return receipt?.transactionHash ?? receipt?.hash ?? '(交易已发送)';
}

async function ensureAllowance(ctx, amount) {
  const allowance = await ctx.publicClient.readContract({
    address: ctx.token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ctx.account.address, ctx.market],
  });
  if (allowance >= amount) return;
  console.log(`授权 ${formatUnits(amount, 6)} USDC 给任务合约…`);
  await sendContract(ctx, {
    address: ctx.token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [ctx.market, amount],
  });
}

async function ensureRecordOnChain(ctx, record, job) {
  if (!recordMatchesChain(record, job, { chainId: Number(ctx.chain.id), market: ctx.market })) {
    throw new Error('本地任务说明与链上 specHash 不一致；拒绝提交或结算');
  }
}

async function verifiedPullRequest(record, prNumber, expectedHeadSha) {
  const repo = record.spec.repo;
  const identity = await getPrIdentity({ repo, prNumber, token: process.env.GITHUB_TOKEN });
  if (identity.repo.toLowerCase() !== repo.toLowerCase() || Number(identity.prNumber) !== Number(prNumber)) {
    throw new Error('GitHub 返回的 PR 身份与任务绑定不一致');
  }
  if (!identity.merged) throw new Error('PR 尚未合并；先完成 CI 并由仓库维护者合并');
  if (expectedHeadSha && identity.headSha.toLowerCase() !== expectedHeadSha.toLowerCase()) {
    throw new Error('PR head SHA 已变化；拒绝使用过期交付证明');
  }
  const settings = githubVerificationSettings();
  const verified = await verifyMergedPr({
    repo,
    prNumber: Number(prNumber),
    expectedHeadSha: identity.headSha,
    requiredChecks: settings.requiredChecks,
    appId: settings.appId,
    token: settings.token,
  });
  if (verified.headSha.toLowerCase() !== identity.headSha.toLowerCase()) throw new Error('CI 检查对应的代码版本与 PR head 不一致');
  return { ...verified, repo, prNumber: Number(prNumber), headSha: identity.headSha };
}

async function verifiedTask(record, options, forSettlement = false) {
  const type = record.spec.type;
  let submission;
  if (type === 'github-pr') {
    if (!forSettlement) requireOptions(options, ['pr']);
    const prNumber = Number(forSettlement ? record.submission?.prNumber : options.pr);
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr 必须是正整数');
    submission = { prNumber, headSha: forSettlement ? record.submission?.headSha : undefined };
  } else {
    if (!forSettlement) requireOptions(options, ['output']);
    const inputPath = options.input ?? record.inputPath ?? record.submission?.inputPath;
    const outputPath = options.output ?? record.submission?.outputPath;
    if (!inputPath || !outputPath) throw new Error('CSV 提交或结算需要输入与输出文件路径');
    submission = { inputPath: resolve(inputPath), outputPath: resolve(outputPath) };
  }
  const verificationReceipt = await verifySubmission({ spec: record.spec, jobId: record.jobId, submission, token: process.env.GITHUB_TOKEN });
  if (type === 'github-pr') submission.headSha = verificationReceipt.artifact.hash;
  return { submission, verificationReceipt };
}

function displayPlan(command, details, sendMode) {
  console.log(JSON.stringify({ mode: sendMode ? 'send' : 'dry-run', command, ...details }, null, 2));
  if (!sendMode) console.log('只读预览：没有签名、授权或发送交易。加入 --send 才会执行链上写入。');
}

async function runPost(options) {
  requireOptions(options, ['title', 'bounty', 'window']);
  const type = options.type ?? 'github-pr';
  const readCtx = await context(undefined);
  assertHsk(readCtx);
  const decimals = Number(await readCtx.publicClient.readContract({ address: readCtx.token, abi: ERC20_ABI, functionName: 'decimals' }));
  const bounty = parseUnits(options.bounty, decimals);
  const window = Number(options.window);
  let input;
  let verification;
  let inputPath;
  if (type === 'github-pr') {
    requireOptions(options, ['issue']);
    const settings = githubVerificationSettings();
    input = { repo: repository(), issue: options.issue };
    verification = { appId: settings.appId, requiredChecks: settings.requiredChecks, forbiddenPaths: ['tests/', '.github/'] };
  } else if (type === 'csv-dedupe') {
    requireOptions(options, ['input', 'key']);
    inputPath = resolve(options.input);
    input = csvTaskInput(await readFile(inputPath, 'utf8'), options.key);
    verification = { rule: 'csv-dedupe-v1' };
  } else {
    throw new Error(`不支持的任务类型：${type}`);
  }
  const spec = createTaskSpec({ chainId: 133, market: readCtx.market, type, input, verification, title: options.title, bounty, window });
  const minimum = await readMarket(readCtx, 'MIN_BOUNTY');
  const minWindow = Number(await readMarket(readCtx, 'MIN_DELIVERY_WINDOW'));
  const maxWindow = Number(await readMarket(readCtx, 'MAX_DELIVERY_WINDOW'));
  if (bounty < minimum) throw new Error(`最低赏金为 ${formatUnits(minimum, decimals)} USDC`);
  if (window < minWindow || window > maxWindow) throw new Error(`交付窗口需在 ${minWindow} 到 ${maxWindow} 秒之间`);
  const cost = await readMarket(readCtx, 'postCost', [bounty]);
  const plan = { type, input: spec.input, verification: spec.verification, title: spec.title, bounty: `${options.bounty} USDC`, totalEscrowAndFee: `${formatUnits(cost, decimals)} USDC`, windowSeconds: window, specHash: hashJobSpec(spec), requiredApproval: `${formatUnits(cost, decimals)} USDC` };
  if (!options.send) return displayPlan('post', plan, false);

  const ctx = await context('requester');
  assertHsk(ctx);
  await ensureAllowance(ctx, cost);
  const receipt = await send(ctx, 'postJob', [bounty, 0n, hashJobSpec(spec), window]);
  const posted = parseEventLogs({ abi: ctx.artifacts.LaborMarketV2.abi, logs: receipt.logs ?? [], eventName: 'JobPosted', strict: false })
    .find((event) => event.address?.toLowerCase() === ctx.market.toLowerCase());
  if (!posted?.args?.jobId) throw new Error(`交易已确认 (${txHash(receipt)})，但未能从 JobPosted 事件读取 jobId`);
  const record = { jobId: String(posted.args.jobId), spec, specHash: hashJobSpec(spec), postedTx: txHash(receipt), inputPath: inputPath ?? null, submission: null, verificationReceipt: null, resultHash: null };
  const path = await saveJobRecord(record);
  displayPlan('post', { ...plan, jobId: record.jobId, transaction: txHash(receipt), localRecord: path }, true);
}

async function runAccept(options) {
  requireOptions(options, ['job']);
  const readCtx = await context(undefined);
  assertHsk(readCtx);
  const job = await getJob(readCtx, options.job);
  assertJobStatus(job, JOB_STATUS.Open, '接单');
  const bond = await readMarket(readCtx, 'bondFor', [job.bounty]);
  if (!options.send) return displayPlan('accept', { job: stringifyJob(job, options.job), workerBondApproval: `${formatUnits(bond, 6)} USDC` }, false);

  const ctx = await context('worker');
  assertHsk(ctx);
  await ensureAllowance(ctx, bond);
  const receipt = await send(ctx, 'acceptJob', [BigInt(options.job)]);
  displayPlan('accept', { jobId: options.job, transaction: txHash(receipt) }, true);
}

async function runSubmit(options) {
  requireOptions(options, ['job']);
  const record = await loadJobRecord(options.job);
  const readCtx = await context(undefined);
  assertHsk(readCtx);
  const job = await getJob(readCtx, options.job);
  await ensureRecordOnChain(readCtx, record, job);
  assertJobStatus(job, JOB_STATUS.Accepted, '提交工作');
  let proof;
  let submission;
  let resultHash;
  if (record.spec?.version === 2) {
    ({ submission, verificationReceipt: proof } = await verifiedTask(record, options));
    resultHash = proof.resultHash;
  } else {
    requireOptions(options, ['pr']);
    const prNumber = Number(options.pr);
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0) throw new Error('--pr 必须是正整数');
    const pr = await verifiedPullRequest(record, prNumber);
    resultHash = hashPrResult(pr.repo, pr.prNumber, pr.headSha);
    submission = { prNumber: pr.prNumber, headSha: pr.headSha };
    proof = { taskType: 'github-pr-v1', artifact: { ref: `${pr.repo}#${pr.prNumber}`, hash: pr.headSha }, resultHash };
  }
  if (!options.send) return displayPlan('submit', { jobId: options.job, verificationReceipt: proof }, false);

  const ctx = await context('worker');
  assertHsk(ctx);
  const signedJob = await getJob(ctx, options.job);
  await ensureRecordOnChain(ctx, record, signedJob);
  assertAddressMatches(signedJob.worker, ctx.account.address, '当前钱包不是该任务接单的 worker');
  const receipt = await send(ctx, 'submitWork', [BigInt(options.job), resultHash]);
  if (record.spec?.version === 2) {
    record.submission = submission;
    record.verificationReceipt = proof;
  } else {
    record.prNumber = submission.prNumber;
    record.headSha = submission.headSha;
  }
  record.resultHash = resultHash;
  record.submittedTx = txHash(receipt);
  const path = await saveJobRecord(record);
  displayPlan('submit', { jobId: options.job, transaction: txHash(receipt), resultHash, localRecord: path }, true);
}

async function runSettle(options) {
  requireOptions(options, ['job']);
  const record = await loadJobRecord(options.job);
  if (!record.resultHash || (record.spec?.version === 2 ? !record.submission : !record.prNumber || !record.headSha)) {
    throw new Error('任务还没有本地提交记录；先运行 submit');
  }
  const readCtx = await context(undefined);
  assertHsk(readCtx);
  const job = await getJob(readCtx, options.job);
  await ensureRecordOnChain(readCtx, record, job);
  assertJobStatus(job, JOB_STATUS.Submitted, '结算');
  let proof;
  let resultHash;
  if (record.spec?.version === 2) {
    ({ verificationReceipt: proof } = await verifiedTask(record, options, true));
    resultHash = proof.resultHash;
  } else {
    const pr = await verifiedPullRequest(record, record.prNumber, record.headSha);
    resultHash = hashPrResult(pr.repo, pr.prNumber, pr.headSha);
    proof = { taskType: 'github-pr-v1', artifact: { ref: `${pr.repo}#${pr.prNumber}`, hash: pr.headSha }, resultHash };
  }
  if (job.resultHash.toLowerCase() !== record.resultHash.toLowerCase() || resultHash.toLowerCase() !== job.resultHash.toLowerCase()) {
    throw new Error('链上结果哈希、本地记录和当前验收成果不一致；拒绝结算');
  }
  if (!options.send) return displayPlan('settle', { jobId: options.job, verificationReceipt: proof, effect: 'approveJob 将把赏金记入 worker 的可提取余额' }, false);

  const ctx = await context('requester');
  assertHsk(ctx);
  const requesterJob = await getJob(ctx, options.job);
  assertAddressMatches(requesterJob.requester, ctx.account.address, '当前钱包不是该任务的 requester');
  const receipt = await send(ctx, 'approveJob', [BigInt(options.job)]);
  displayPlan('settle', { jobId: options.job, transaction: txHash(receipt), effect: '赏金已记为可提取；worker 仍需单独执行 withdraw' }, true);
}

async function runStatus(options) {
  requireOptions(options, ['job']);
  const ctx = await context(undefined);
  assertHsk(ctx);
  const job = await getJob(ctx, options.job);
  const decimals = Number(await ctx.publicClient.readContract({ address: ctx.token, abi: ERC20_ABI, functionName: 'decimals' }));
  const requesterBalance = await readMarket(ctx, 'withdrawable', [job.requester]);
  const workerBalance = job.worker === '0x0000000000000000000000000000000000000000'
    ? 0n
    : await readMarket(ctx, 'withdrawable', [job.worker]);
  console.log(JSON.stringify({
    ...stringifyJob(job, options.job, decimals),
    requesterClaimable: `${formatUnits(requesterBalance, decimals)} USDC`,
    workerClaimable: `${formatUnits(workerBalance, decimals)} USDC`,
    note: '可提取余额不等于已转入钱包；withdraw 后才会转账。',
  }, null, 2));
}

async function runTerminalAction(command, options) {
  requireOptions(options, ['job']);
  const ctx = await context(undefined);
  assertHsk(ctx);
  const job = await getJob(ctx, options.job);
  const expected = { cancel: JOB_STATUS.Open, reclaim: JOB_STATUS.Accepted, 'expire-open': JOB_STATUS.Open, 'expire-review': JOB_STATUS.Submitted }[command];
  assertJobStatus(job, expected, command);
  const functionName = { cancel: 'cancelJob', reclaim: 'reclaimJob', 'expire-open': 'expireOpen', 'expire-review': 'expireReview' }[command];
  if (!options.send) return displayPlan(command, { job: stringifyJob(job, options.job), contractCall: functionName }, false);
  const signer = await context('requester');
  assertHsk(signer);
  if (command === 'cancel') assertAddressMatches(job.requester, signer.account.address, '只有 requester 可以取消任务');
  const receipt = await send(signer, functionName, [BigInt(options.job)]);
  displayPlan(command, { jobId: options.job, transaction: txHash(receipt) }, true);
}

async function runWithdraw(options) {
  requireOptions(options, ['role']);
  if (!['requester', 'worker'].includes(options.role)) throw new Error('--role 只能是 requester 或 worker');
  if (!options.send) {
    const ctx = await context(undefined);
    assertHsk(ctx);
    return displayPlan('withdraw', { role: options.role, contractCall: 'withdraw', note: '具体可提取金额可用 status --job 查看' }, false);
  }
  const ctx = await context(options.role);
  assertHsk(ctx);
  const receipt = await send(ctx, 'withdraw', []);
  displayPlan('withdraw', { role: options.role, transaction: txHash(receipt), note: '请在链上浏览器确认 Withdrawn 事件和余额变化' }, true);
}

export async function runCli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    throw new Error(`${error.message}\n${usage}`);
  }
  const { command, options } = parsed;
  try {
    if (command === 'post') return await runPost(options);
    if (command === 'accept') return await runAccept(options);
    if (command === 'submit') return await runSubmit(options);
    if (command === 'settle') return await runSettle(options);
    if (command === 'status') return await runStatus(options);
    if (['cancel', 'reclaim', 'expire-open', 'expire-review'].includes(command)) return await runTerminalAction(command, options);
    if (command === 'withdraw') return await runWithdraw(options);
    throw new Error(`未知命令：${command}\n${usage}`);
  } catch (error) {
    throw new Error(`${error.message}\n${options.send ? '如需预览，可去掉 --send。' : ''}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`错误：${error.message}`);
    process.exitCode = 1;
  });
}
