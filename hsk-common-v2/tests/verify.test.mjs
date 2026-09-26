import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskSpec } from '../src/jobs.mjs';
import { csvTaskInput, verifySubmission } from '../src/verify.mjs';
import { dedupeKeepFirst, parseCsv, serializeCsv } from '../acceptance/csv-dedupe/csv-dedupe.mjs';

const market = '0x1111111111111111111111111111111111111111';
const common = { market, title: 'Task', bounty: 1_000_000n, window: 3600 };
const source = 'id,name\n1,Alice\n1,Other\n2,Bob\n';
const output = serializeCsv(dedupeKeepFirst(parseCsv(source), 'id'));

test('CSV receipt binds the exact input and verified output to a job', async () => {
  const spec = createTaskSpec({ ...common, type: 'csv-dedupe', input: csvTaskInput(source, 'id'), verification: { rule: 'csv-dedupe-v1' } });
  const files = { input: source, output };
  const run = (values = files) => verifySubmission({ spec, jobId: 2, submission: { inputPath: 'input', outputPath: 'output' }, readFileImpl: async (path) => values[path] });
  const receipt = await run();
  assert.equal(receipt.verified, true);
  assert.equal(receipt.taskType, 'csv-dedupe');
  assert.match(receipt.resultHash, /^0x[0-9a-f]{64}$/);
  await assert.rejects(() => run({ ...files, input: source + '3,Eve\n' }), /输入文件.*不一致/);
  await assert.rejects(() => run({ ...files, output: 'id,name\n1,Alice\n' }), /CSV 验收失败/);
});

test('GitHub receipt requires the task issue, safe PR diff, and configured CI app', async () => {
  const spec = createTaskSpec({ ...common, type: 'github-pr', input: { repo: 'org/repo', issue: 7 }, verification: { appId: 1234, requiredChecks: ['CI'], forbiddenPaths: ['tests/', '.github/'] } });
  const sha = 'a'.repeat(40);
  const response = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => data });
  const fetchFor = ({ body = 'Closes #7', filename = 'src/fix.js', appId = 1234 } = {}) => async (url) => {
    if (url.includes('/pulls/5/files')) return response([{ filename }]);
    if (url.includes('/pulls/5')) return response({ base: { repo: { full_name: 'org/repo' } }, number: 5, head: { sha }, merged: true, body });
    return response({ total_count: 1, check_runs: [{ name: 'CI', app: { id: appId }, status: 'completed', conclusion: 'success', id: 99 }] });
  };
  const run = (options) => verifySubmission({ spec, jobId: 3, submission: { prNumber: 5 }, fetchImpl: fetchFor(options) });
  const receipt = await run();
  assert.equal(receipt.artifact.hash, sha);
  assert.equal(receipt.evidence.checks[0].id, 99);
  await assert.rejects(() => run({ body: 'Closes #70' }), /does not declare closure of task issue #7/);
  await assert.rejects(() => run({ body: 'See #7' }), /does not declare closure of task issue #7/);
  await assert.rejects(() => run({ filename: '.github/workflows/ci.yml' }), /forbidden path/);
  await assert.rejects(() => run({ appId: 9 }), /check is missing/);
});
