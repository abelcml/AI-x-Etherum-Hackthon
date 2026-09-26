import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrIdentity, verifyMergedPr } from '../src/github.mjs';
import { hashPrResult } from '../src/proof.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const REPO = 'org/project';
const APP_ID = 1234;

function response(data, { status = 200, link = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'link' ? link : null },
    json: async () => data,
  };
}

function pullRequest(overrides = {}) {
  return {
    base: { repo: { full_name: REPO } },
    number: 7,
    head: { sha: SHA },
    merged: true,
    ...overrides,
  };
}

function checkRun(name, overrides = {}) {
  return {
    id: 99,
    name,
    app: { id: APP_ID },
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function apiFetch({ pr = pullRequest(), pages = [{ total_count: 1, check_runs: [checkRun('CI')] }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/pulls/')) return response(pr);
    const page = Number(new URL(String(url)).searchParams.get('page'));
    const body = pages[page - 1];
    if (!body) return response({ total_count: 0, check_runs: [] });
    return response(body.data ?? body, { link: body.link ?? '' });
  };
  return { calls, fetchImpl };
}

test('getPrIdentity validates repository, number and commit SHA and never puts token in URL', async () => {
  const { calls, fetchImpl } = apiFetch();
  const identity = await getPrIdentity({ repo: REPO, prNumber: 7, token: 'secret-token', fetchImpl });
  assert.deepEqual(identity, { repo: REPO, prNumber: 7, headSha: SHA, merged: true });
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/org\/project\/pulls\/7$/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0].url.includes('secret-token'), false);
  assert.equal(calls[0].init.signal.aborted, false);
});

test('getPrIdentity rejects repository or pull request identity mismatches and malformed SHA', async () => {
  await assert.rejects(() => getPrIdentity({ repo: 'https://evil.test/org/repo', prNumber: 7, fetchImpl: async () => response({}) }), /repo must/);
  await assert.rejects(() => getPrIdentity({ repo: REPO, prNumber: 7, fetchImpl: async () => response(pullRequest({ number: 8 })) }), /number does not match/);
  await assert.rejects(() => getPrIdentity({ repo: REPO, prNumber: 7, fetchImpl: async () => response(pullRequest({ head: { sha: 'bad' } })) }), /40-character/);
  await assert.rejects(() => getPrIdentity({ repo: REPO, prNumber: 7, fetchImpl: async () => response(pullRequest({ base: { repo: { full_name: 'other/repo' } } })) }), /repository does not match/);
});

test('verifyMergedPr accepts only merged PR at the requested SHA with required app checks', async () => {
  const { fetchImpl } = apiFetch({ pages: [{ total_count: 2, check_runs: [checkRun('CI'), checkRun('Security')] }] });
  const result = await verifyMergedPr({
    repo: REPO,
    prNumber: 7,
    expectedHeadSha: SHA,
    requiredChecks: ['CI', 'Security'],
    appId: APP_ID,
    fetchImpl,
  });
  assert.equal(result.headSha, SHA);
  assert.deepEqual(result.checks.map(({ name }) => name), ['CI', 'Security']);
});

test('verifyMergedPr rejects wrong SHA, unmerged PR, missing, pending and failed checks', async (t) => {
  const cases = [
    ['wrong SHA', { pr: pullRequest({ head: { sha: OTHER_SHA } }) }, /does not match the expected SHA/],
    ['unmerged PR', { pr: pullRequest({ merged: false }) }, /has not been merged/],
    ['missing check', { pages: [{ total_count: 0, check_runs: [] }] }, /check is missing/],
    ['pending check', { pages: [{ total_count: 1, check_runs: [checkRun('CI', { status: 'in_progress', conclusion: null })] }] }, /did not complete successfully/],
    ['failed check', { pages: [{ total_count: 1, check_runs: [checkRun('CI', { conclusion: 'failure' })] }] }, /did not complete successfully/],
  ];
  for (const [name, mock, expected] of cases) {
    await t.test(name, async () => {
      const { fetchImpl } = apiFetch(mock);
      await assert.rejects(() => verifyMergedPr({ repo: REPO, prNumber: 7, expectedHeadSha: SHA, requiredChecks: ['CI'], appId: APP_ID, fetchImpl }), expected);
    });
  }
});

test('verifyMergedPr only accepts checks created by the configured GitHub App', async () => {
  const { fetchImpl } = apiFetch({ pages: [{ total_count: 1, check_runs: [checkRun('CI', { app: { id: APP_ID + 1 } })] }] });
  await assert.rejects(() => verifyMergedPr({ repo: REPO, prNumber: 7, expectedHeadSha: SHA, requiredChecks: ['CI'], appId: APP_ID, fetchImpl }), /check is missing/);
});

test('verifyMergedPr follows check-run pagination and fails closed when pages are incomplete', async (t) => {
  await t.test('reads next page', async () => {
    const { calls, fetchImpl } = apiFetch({ pages: [
      { total_count: 2, check_runs: [checkRun('noise')], link: '<https://api.github.com/next>; rel="next"' },
      { total_count: 2, check_runs: [checkRun('CI')] },
    ] });
    const result = await verifyMergedPr({ repo: REPO, prNumber: 7, expectedHeadSha: SHA, requiredChecks: ['CI'], appId: APP_ID, fetchImpl });
    assert.equal(result.checks.length, 1);
    assert.ok(calls.some(({ url }) => url.includes('page=2')));
  });
  await t.test('rejects truncated response without a next link', async () => {
    const { fetchImpl } = apiFetch({ pages: [{ total_count: 2, check_runs: [checkRun('CI')] }] });
    await assert.rejects(() => verifyMergedPr({ repo: REPO, prNumber: 7, expectedHeadSha: SHA, requiredChecks: ['CI'], appId: APP_ID, fetchImpl }), /pagination was incomplete/);
  });
});

test('verifyMergedPr rejects malformed configuration', async () => {
  const { fetchImpl } = apiFetch();
  const base = { repo: REPO, prNumber: 7, expectedHeadSha: SHA, requiredChecks: ['CI'], appId: APP_ID, fetchImpl };
  await assert.rejects(() => verifyMergedPr({ ...base, requiredChecks: [] }), /between 1 and 20/);
  await assert.rejects(() => verifyMergedPr({ ...base, requiredChecks: ['CI', 'CI'] }), /duplicates/);
  await assert.rejects(() => verifyMergedPr({ ...base, appId: 0 }), /positive safe integer/);
});

test('hashPrResult is deterministic and normalizes repository and SHA case', () => {
  const first = hashPrResult('Org/Project', 7, SHA.toUpperCase());
  const second = hashPrResult('org/project', 7, SHA);
  assert.equal(first, second);
  assert.match(first, /^0x[0-9a-f]{64}$/);
  assert.notEqual(first, hashPrResult(REPO, 8, SHA));
});

test('hashPrResult rejects malformed task identity', () => {
  assert.throws(() => hashPrResult('not a repo', 7, SHA), /repo must/);
  assert.throws(() => hashPrResult(REPO, 0, SHA), /positive safe integer/);
  assert.throws(() => hashPrResult(REPO, 7, 'bad'), /40-character/);
});
