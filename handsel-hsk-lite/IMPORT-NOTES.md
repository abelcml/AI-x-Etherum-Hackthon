# Import notes

Source: https://github.com/Kairose-master/handsel
Upstream commit: `482c3106efe16ec5d229ef945d7d95ef972d2b76`
Local adaptation commit: `d9e6df6`

This directory is a source snapshot with small HSK testnet and GitHub settlement adaptations. Original LICENSE and per-file notices are retained. The deprecated lowercase `Claude.md` alias was removed to avoid its Windows filename collision with `CLAUDE.md`.

Validation: 46 targeted tests passed (HSK chain/deployment/settlement, RPC transport, secret scan); TypeScript typecheck passed. No production build, actual GitHub App webhook end-to-end run, contract deployment or transaction was performed.

Known integration limits: a CI webhook that arrives before the PR-to-job database association can be missed; replay that event after association or add reconciliation before relying on unattended operation. Required check names/App ID must match the actual demo repository. Existing optional upstream features are preserved but are outside the demo scope.

Start with `README-HSK.md` and `docs/PROJECT-BRIEF.md`. Upstream deployment and audit claims in other documents do not certify this snapshot. Workflows inside this nested directory do not automatically run as root GitHub Actions; local validation commands run from this directory.
