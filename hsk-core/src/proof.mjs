import { keccak256, toHex } from 'viem';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-fA-F0-9]{40}$/;

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
