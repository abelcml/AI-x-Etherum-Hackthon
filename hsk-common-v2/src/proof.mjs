import { keccak256, toHex } from 'viem';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-fA-F0-9]{40}$/;
const HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

/** Build a deterministic on-chain result commitment for a verified GitHub PR. */
export function hashPrResult(repo, prNumber, headSha) {
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
    throw new TypeError('repo must be a GitHub owner/repository name');
  }
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) {
    throw new TypeError('prNumber must be a positive safe integer');
  }
  if (typeof headSha !== 'string' || !SHA_PATTERN.test(headSha)) {
    throw new TypeError('headSha must be a 40-character Git commit SHA');
  }

  const payload = JSON.stringify(['handsel-hsk-pr-v1', repo.toLowerCase(), prNumber, headSha.toLowerCase()]);
  return keccak256(toHex(payload));
}

/** Bind a verified artifact to the specific version 2 job and its sealed policy. */
export function hashTaskResult({ jobId, specHash, taskType, artifactRef, artifactHash }) {
  let id;
  try { id = BigInt(jobId); } catch { throw new TypeError('jobId must be a positive integer'); }
  if (id < 1n || !HASH_PATTERN.test(specHash ?? '')) throw new TypeError('jobId and specHash must identify a posted task');
  const artifactPattern = taskType === 'github-pr' ? SHA_PATTERN : taskType === 'csv-dedupe' ? /^[a-fA-F0-9]{64}$/ : null;
  if (!artifactPattern?.test(artifactHash ?? '')) {
    throw new TypeError('taskType and artifactHash must identify a supported artifact');
  }
  if (taskType === 'github-pr' && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/.test(artifactRef ?? '')) {
    throw new TypeError('GitHub artifactRef must identify owner/repo#pr');
  }
  const canonicalRef = taskType === 'github-pr' ? artifactRef.toLowerCase() : '';
  const payload = JSON.stringify(['handsel-hsk-result-v2', id.toString(), specHash.toLowerCase(), taskType, canonicalRef, artifactHash.toLowerCase()]);
  return keccak256(toHex(payload));
}
