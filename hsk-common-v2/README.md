# HSK common verification v2 — isolated CLI package

This directory is a separate copy of the HSK task CLI for the hackathon's generic verification flow. It does **not** replace or import the running `hsk-core/` Task Commons demo. It uses the same deployed LaborMarketV2 contract interface; no contract migration is required. Do not start this package as the existing web demo.

## Included environment

- Node.js 22.18+ and pnpm 11 are pinned by `package.json` and `pnpm-lock.yaml`.
- `Dockerfile` provides a reproducible Node build that installs dependencies, compiles the contracts, and runs the tests. `.dockerignore` excludes local secrets and generated state.
- `.env.example` lists the HSK testnet, contract addresses, GitHub policy, and per-role wallet settings. Copy it to `.env.local` locally. Never include real private keys in an archive or commit.
- The CSV reference executor, verifier, sample input, and tests are included under `acceptance/csv-dedupe/`; this package does not depend on files in the original demo tree.
- `contracts/`, `scripts/`, `src/`, and `tests/` are included. Generated `artifacts/` and `.data/` stay local.

## Build and test

From this directory:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm compile
pnpm test
cp .env.example .env.local
pnpm check --type csv-dedupe
```

The container alternative is `docker build -t hsk-common-v2 .`; use a locally mounted `.env.local` only if running commands that need configuration. Building an image downloads the pinned npm packages and does not access the HSK wallet.

## Shared task flow

```text
TaskSpec -> specHash -> locked test tokens -> artifact
         -> VerificationReceipt -> resultHash -> requester approval -> worker withdrawal
```

Version 2 `specHash` commits to the task type, input identity, verifier policy, chain, market, bounty, and delivery window. The GitHub adapter checks the merged PR head SHA, configured GitHub App checks, task Issue closing declaration, and forbidden paths. The CSV adapter checks the published input hash and four deterministic output rules. Both return the same local receipt shape and the CLI re-verifies before approval. Existing version 1 job records keep their original hash rules.

Writes are previews unless `--send` is supplied. A CSV preview sequence is:

```sh
pnpm job post --type csv-dedupe --input acceptance/csv-dedupe/sample.csv --key id --title "CSV dedupe" --bounty 1 --window 3600
node acceptance/csv-dedupe/cli.mjs run acceptance/csv-dedupe/sample.csv id ./result.csv
```

For a real testnet run, authorized teammates add `--send` one step at a time to `post`, `accept`, `submit --output ./result.csv`, `settle`, and `withdraw --role worker`, using the actual job ID returned by `post`. GitHub jobs use `post --type github-pr --issue <issue>`, `submit --pr <pr>`, then `settle` and `withdraw`. See `scripts/job.mjs` for all flags.

The contract cannot read GitHub or CSV data. It trusts the requester wallet's approval; a requester can bypass the CLI. The receipt is local JSON, not a signed or on-chain attestation. Version 2 GitHub and CSV jobs have not yet been paid on HSK testnet. The existing Task Commons demo remains on the version 1 runtime and has its own historical payment evidence.
