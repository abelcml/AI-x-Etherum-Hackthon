import { readFile } from 'node:fs/promises';
import { expectedSha256, sha256, verifyCsvDedupe } from '../acceptance/csv-dedupe/csv-dedupe.mjs';
import { verifyMergedPr } from './github.mjs';
import { createTaskSpec, hashJobSpec } from './jobs.mjs';
import { hashTaskResult } from './proof.mjs';

/** Both adapters return the same receipt shape; settlement re-runs verification. */
export async function verifySubmission({ spec, jobId, submission, token, fetchImpl = fetch, readFileImpl = readFile }) {
  const task = createTaskSpec(spec);
  const specHash = hashJobSpec(task);
  let artifact;
  let evidence;

  if (task.type === 'github-pr') {
    const prNumber = Number(submission?.prNumber);
    const verified = await verifyMergedPr({
      repo: task.input.repo,
      prNumber,
      expectedHeadSha: submission?.headSha,
      expectedIssue: task.input.issue,
      requiredChecks: task.verification.requiredChecks,
      appId: task.verification.appId,
      forbiddenPaths: task.verification.forbiddenPaths,
      token,
      fetchImpl,
    });
    artifact = { kind: 'github-pr', ref: `${task.input.repo}#${prNumber}`, hash: verified.headSha };
    evidence = { merged: true, issue: task.input.issue, checks: verified.checks };
  } else {
    if (!submission?.inputPath || !submission?.outputPath) throw new Error('CSV 验收需要输入与输出文件路径');
    const inputText = await readFileImpl(submission.inputPath, 'utf8');
    const outputText = await readFileImpl(submission.outputPath, 'utf8');
    const inputHash = sha256(inputText);
    if (inputHash !== task.input.inputSha256) throw new Error('CSV 输入文件与发布时的哈希不一致');
    const verdict = verifyCsvDedupe({ inputText, outputText, key: task.input.key, expectedSha: task.input.expectedSha256 });
    if (!verdict.passed) throw new Error(`CSV 验收失败：${verdict.reasons.join('; ')}`);
    artifact = { kind: 'csv-dedupe', ref: submission.outputPath, hash: verdict.outputSha256 };
    evidence = { rule: task.verification.rule, inputSha256: inputHash, expectedSha256: task.input.expectedSha256, outputSha256: verdict.outputSha256 };
  }

  return {
    version: 2,
    jobId: BigInt(jobId).toString(),
    taskType: task.type,
    specHash,
    artifact,
    verified: true,
    evidence,
    resultHash: hashTaskResult({ jobId, specHash, taskType: task.type, artifactRef: artifact.ref, artifactHash: artifact.hash }),
  };
}

/** Compute the published answer commitment without accepting a worker result. */
export function csvTaskInput(inputText, key) {
  return { inputSha256: sha256(inputText), key, expectedSha256: expectedSha256(inputText, key) };
}
