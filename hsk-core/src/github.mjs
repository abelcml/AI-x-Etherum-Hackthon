const API_ROOT = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CHECK_PAGES = 20;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-fA-F0-9]{40}$/;

function validateRepo(repo) {
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
    throw new TypeError('repo must be a GitHub owner/repository name');
  }
  return repo.toLowerCase();
}

function validatePrNumber(prNumber) {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) {
    throw new TypeError('prNumber must be a positive safe integer');
  }
  return prNumber;
}

function validateSha(sha, label) {
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) {
    throw new TypeError(`${label} must be a 40-character Git commit SHA`);
  }
  return sha.toLowerCase();
}

function authToken(token) {
  if (token === undefined || token === null || token === '') return undefined;
  if (typeof token !== 'string') throw new TypeError('token must be a string');
  return token;
}

function hasNextPage(linkHeader) {
  return typeof linkHeader === 'string' && /<[^>]+>\s*;\s*rel="?next"?/i.test(linkHeader);
}

async function requestJson(path, { token, fetchImpl }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetchImpl(`${API_ROOT}${path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('GitHub API request failed or timed out');
  }
  if (!response || !response.ok) {
    const status = Number.isInteger(response?.status) ? response.status : 'unknown';
    throw new Error(`GitHub API request failed (HTTP ${status})`);
  }
  try {
    return { data: await response.json(), link: response.headers?.get?.('link') ?? '' };
  } catch {
    throw new Error('GitHub API returned invalid JSON');
  }
}

/** Fetch and validate the immutable identity of a GitHub pull request. */
export async function getPrIdentity({ repo, prNumber, token = process.env.GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  const normalizedRepo = validateRepo(repo);
  const number = validatePrNumber(prNumber);
  const bearer = authToken(token);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  const [owner, name] = normalizedRepo.split('/');
  const { data } = await requestJson(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`,
    { token: bearer, fetchImpl },
  );
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('GitHub API returned an invalid pull request');
  }
  if (typeof data.base?.repo?.full_name !== 'string' || data.base.repo.full_name.toLowerCase() !== normalizedRepo) {
    throw new Error('Pull request repository does not match the requested repository');
  }
  if (data.number !== number) throw new Error('Pull request number does not match the request');
  const headSha = validateSha(data.head?.sha, 'head SHA');
  if (typeof data.merged !== 'boolean') throw new Error('GitHub API omitted the pull request merge state');

  return { repo: normalizedRepo, prNumber: number, headSha, merged: data.merged };
}

/**
 * Verify that a merged PR still points at the expected commit and that every
 * named latest check run from the required GitHub App completed successfully.
 */
export async function verifyMergedPr({
  repo,
  prNumber,
  expectedHeadSha,
  requiredChecks,
  appId,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const normalizedRepo = validateRepo(repo);
  const number = validatePrNumber(prNumber);
  const expectedSha = validateSha(expectedHeadSha, 'expectedHeadSha');
  if (!Array.isArray(requiredChecks) || requiredChecks.length < 1 || requiredChecks.length > 20) {
    throw new TypeError('requiredChecks must contain between 1 and 20 check names');
  }
  const checksToRequire = requiredChecks.map((name) => {
    if (typeof name !== 'string' || name.trim() === '' || name !== name.trim()) {
      throw new TypeError('required check names must be non-empty trimmed strings');
    }
    return name;
  });
  if (new Set(checksToRequire).size !== checksToRequire.length) {
    throw new TypeError('requiredChecks must not contain duplicates');
  }
  if (!Number.isSafeInteger(appId) || appId < 1) throw new TypeError('appId must be a positive safe integer');
  const bearer = authToken(token);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  const identity = await getPrIdentity({ repo: normalizedRepo, prNumber: number, token: bearer, fetchImpl });
  if (!identity.merged) throw new Error('Pull request has not been merged');
  if (identity.headSha !== expectedSha) throw new Error('Pull request head SHA does not match the expected SHA');

  const [owner, name] = normalizedRepo.split('/');
  const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${identity.headSha}/check-runs`;
  const allRuns = [];
  let page = 1;
  while (true) {
    const { data, link } = await requestJson(`${prefix}?filter=latest&per_page=100&page=${page}`, {
      token: bearer,
      fetchImpl,
    });
    if (!data || !Array.isArray(data.check_runs) || !Number.isSafeInteger(data.total_count) || data.total_count < 0) {
      throw new Error('GitHub API returned an invalid check run list');
    }
    allRuns.push(...data.check_runs);
    if (!hasNextPage(link)) {
      if (allRuns.length < data.total_count) throw new Error('GitHub check run pagination was incomplete');
      break;
    }
    if (page >= MAX_CHECK_PAGES) throw new Error('GitHub check run pagination exceeded the safety limit');
    page += 1;
  }

  const checks = [];
  for (const checkName of checksToRequire) {
    const matching = allRuns.filter((run) => run?.name === checkName && run?.app?.id === appId);
    if (matching.length === 0) throw new Error(`Required check is missing: ${checkName}`);
    for (const run of matching) {
      if (run.status !== 'completed' || run.conclusion !== 'success') {
        throw new Error(`Required check did not complete successfully: ${checkName}`);
      }
      checks.push({
        name: run.name,
        appId: run.app.id,
        status: run.status,
        conclusion: run.conclusion,
        id: Number.isSafeInteger(run.id) ? run.id : null,
      });
    }
  }
  return { ...identity, checks };
}
