import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAddressMatches,
  assertJobStatus,
  createJobSpec,
  createTaskSpec,
  hashJobSpec,
  normalizeJob,
  parseCliArgs,
  recordMatchesChain,
  statusName,
  JOB_STATUS,
} from '../src/jobs.mjs';
import { hashTaskResult } from '../src/proof.mjs';

const market = '0x1111111111111111111111111111111111111111';

test('job spec commitment is stable and binds the GitHub issue and escrow terms', () => {
  const spec = createJobSpec({ chainId: 133, market, repo: 'Team/Repo', issue: '7', title: ' Fix parser ', bounty: 1_000_000n, window: '3600' });
  assert.deepEqual(spec, {
    version: 1,
    chainId: 133,
    market,
    repo: 'team/repo',
    issue: 7,
    title: 'Fix parser',
    bounty: '1000000',
    window: 3600,
  });
  assert.equal(hashJobSpec(spec), hashJobSpec({ ...spec }));
  assert.notEqual(hashJobSpec(spec), hashJobSpec({ ...spec, issue: 8 }));
  assert.notEqual(hashJobSpec(spec), hashJobSpec({ ...spec, bounty: '2000000' }));
  assert.equal(recordMatchesChain({ spec }, { specHash: hashJobSpec(spec) }, { chainId: 133, market }), true);
  assert.equal(recordMatchesChain({ spec }, { specHash: `0x${'0'.repeat(64)}` }, { chainId: 133, market }), false);
});

test('job spec refuses missing or invalid task bounds before any chain action', () => {
  assert.throws(() => createJobSpec({ market, repo: 'team/repo', issue: 0, title: 'x', bounty: 1n, window: 1 }), /issue/);
  assert.throws(() => createJobSpec({ market, repo: 'team/repo', issue: 1, title: ' ', bounty: 1n, window: 1 }), /标题/);
  assert.throws(() => createJobSpec({ market, repo: 'team/repo', issue: 1, title: 'x', bounty: 0n, window: 1 }), /赏金/);
  assert.throws(() => createJobSpec({ market, repo: 'team/repo', issue: 1, title: 'x', bounty: 1n, window: 0 }), /期限/);
});

test('version 2 seals GitHub verification policy and CSV acceptance terms', () => {
  const common = { market, title: 'Task', bounty: 1_000_000n, window: 3600 };
  const github = createTaskSpec({ ...common, type: 'github-pr', input: { repo: 'Team/Repo', issue: 7 }, verification: { appId: 1234, requiredChecks: ['CI'], forbiddenPaths: ['tests/', '.github/'] } });
  const csv = createTaskSpec({ ...common, type: 'csv-dedupe', input: { inputSha256: 'a'.repeat(64), key: 'id', expectedSha256: 'b'.repeat(64) }, verification: { rule: 'csv-dedupe-v1' } });
  assert.equal(recordMatchesChain({ spec: github }, { specHash: hashJobSpec(github) }, { chainId: 133, market }), true);
  assert.equal(recordMatchesChain({ spec: csv }, { specHash: hashJobSpec(csv) }, { chainId: 133, market }), true);
  assert.notEqual(hashJobSpec(github), hashJobSpec({ ...github, verification: { ...github.verification, requiredChecks: ['Other'] } }));
  assert.notEqual(hashJobSpec(csv), hashJobSpec({ ...csv, input: { ...csv.input, expectedSha256: 'c'.repeat(64) } }));
  assert.throws(() => createTaskSpec({ ...common, type: 'csv-dedupe', input: { inputSha256: 'bad', key: 'id', expectedSha256: 'b'.repeat(64) }, verification: { rule: 'csv-dedupe-v1' } }), /CSV/);
});

test('version 2 result commitment cannot be replayed across jobs or specs', () => {
  const proof = { jobId: '1', specHash: `0x${'a'.repeat(64)}`, taskType: 'csv-dedupe', artifactHash: 'b'.repeat(64) };
  const first = hashTaskResult(proof);
  assert.notEqual(first, hashTaskResult({ ...proof, jobId: '2' }));
  assert.notEqual(first, hashTaskResult({ ...proof, specHash: `0x${'c'.repeat(64)}` }));
  assert.notEqual(first, hashTaskResult({ ...proof, artifactHash: 'd'.repeat(64) }));
  const github = { ...proof, taskType: 'github-pr', artifactRef: 'org/repo#5', artifactHash: 'a'.repeat(40) };
  assert.notEqual(hashTaskResult(github), hashTaskResult({ ...github, artifactRef: 'org/repo#6' }));
});

test('normalizes the LaborMarketV2 job tuple and maps terminal status names', () => {
  const tuple = [market, '0x2222222222222222222222222222222222222222', 12n, 0n, 2, `0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`, 10n, 20n, 30n, 0n, 3600, `0x${'0'.repeat(40)}`, 0n];
  const job = normalizeJob(tuple);
  assert.equal(job.requester, market);
  assert.equal(job.bounty, 12n);
  assert.equal(job.status, JOB_STATUS.Submitted);
  assert.equal(statusName(7), 'Expired');
  assert.throws(() => assertJobStatus(job, JOB_STATUS.Accepted, '接单'), /当前为 Submitted/);
  assert.doesNotThrow(() => assertJobStatus(job, JOB_STATUS.Submitted, '结算'));
});

test('address guard compares case-insensitively and fails closed on absent identities', () => {
  assert.doesNotThrow(() => assertAddressMatches(market.toUpperCase().replace('0X', '0x'), market, 'mismatch'));
  assert.throws(() => assertAddressMatches(undefined, market, 'not requester'), /not requester/);
  assert.throws(() => assertAddressMatches('0x2222222222222222222222222222222222222222', market, 'not requester'), /not requester/);
});

test('CLI parser accepts dry defaults and explicit send without shell evaluation', () => {
  assert.deepEqual(parseCliArgs(['post', '--issue', '7', '--title', 'Fix parser', '--bounty', '1', '--window', '3600']), {
    command: 'post', options: { issue: '7', title: 'Fix parser', bounty: '1', window: '3600' },
  });
  assert.deepEqual(parseCliArgs(['accept', '--job', '2', '--send']), { command: 'accept', options: { job: '2', send: true } });
  assert.throws(() => parseCliArgs(['accept', '--job', '--send']), /缺少取值/);
  assert.throws(() => parseCliArgs(['accept', '--job', '1', '--job', '2']), /重复/);
});
