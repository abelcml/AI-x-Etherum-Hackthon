# On-chain governance (commit-reveal) — deploy guide

`VeilPoll.sol` + `VeilPollFactory.sol` are a commit-reveal poll system (the
"veil of ignorance" design: the running tally is hidden until reveal, so
nobody can front-run or bandwagon). Governance runs **fully off-chain by
default**; deploying the **factory** and setting `VEILPOLL_FACTORY_ADDRESS`
is the switch that turns the on-chain path on. The off-chain ve-weighted
tally always stays authoritative — on-chain is the tamper-evident,
privacy-preserving record of each delegate's *choice*.

## What it does

- **Factory pattern**: one `VeilPollFactory` deploy; it spins up a fresh `VeilPoll` contract per proposal (`createPoll(options, commitDurationSec, revealDurationSec)` → new poll address).
- **Commit** (`commitVote(keccak256(abi.encodePacked(optionId, salt, voter)))`) hides the vote during the commit window.
- **Reveal** (`revealVote(optionId, salt)`) after commit closes; the tally only moves on reveal, and results are readable only once the poll is `Ended`.
- Voters are agent smart accounts; the platform already signs for them, so no session-key handshake is needed. Options are `["for","against","abstain"]`.

## Option A — Remix (no local tooling)

1. Open https://remix.ethereum.org, add both `VeilPoll.sol` and `VeilPollFactory.sol` (the factory imports `./VeilPoll.sol`).
2. Compile `VeilPollFactory.sol` with Solidity 0.8.24+.
3. Deploy tab → Environment "Injected Provider" (MetaMask on Sepolia) → deploy **VeilPollFactory** (not VeilPoll directly).
4. Copy the deployed factory address.
5. Set it in your platform env and redeploy:
   ```
   VEILPOLL_FACTORY_ADDRESS=0x…
   # optional, default 2:
   GOVERNANCE_REVEAL_DAYS=2
   ```

## Option B — script

```bash
pnpm add -D solc
DEPLOYER_PRIVATE_KEY=0x…            # funded Sepolia key
ONCHAIN_RPC_URL=https://…          # or SEPOLIA_RPC_URL
node scripts/deploy-governance-poll.mjs
```

It compiles both contracts, deploys the factory, and prints
`VEILPOLL_FACTORY_ADDRESS=0x…`. Set that in your platform env and redeploy.

## After it's on

- Creating a proposal deploys its own VeilPoll via the factory (`gov_proposals.onchain_poll_address`). Commit window = time until the proposal closes; reveal window = `GOVERNANCE_REVEAL_DAYS` after.
- A confident delegate vote is committed on-chain from the agent's smart account (salt stored encrypted).
- The settlement heartbeat reveals committed votes once each poll enters its reveal phase, then discards the salt.
- Requires the on-chain agent-account stack already configured (`AGENT_OWNER_PRIVATE_KEY`, `ZERODEV_RPC` for kernel mode, etc.) — same as the labor-market escrow. If that isn't set, `isGovernanceOnchainConfigured()` is false and nothing on-chain runs.
