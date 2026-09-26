# Demo 劇本與逐字稿（3 分鐘展示 + 2 分鐘 QA）

假設評審以英文為主（Sydney 場），所以**口說逐字稿用英文**，動作說明用中文。每段標了目標秒數，整段約 380 個英文字，正常語速大約 2 分 45 秒。

## 上台前準備（先開好分頁，依序排列）

| 分頁 | 網址 | 用途 |
|---|---|---|
| 1 | https://bee-column-lexington-bob.trycloudflare.com | 網頁流程示範（模擬） |
| 2 | https://github.com/abelcml/AI-x-Etherum-Hackthon/pull/10 | 真實 PR：CI 綠勾 + merged |
| 3 | https://testnet-explorer.hskchain.net/address/0xf7400c17e0b48ac3166efead6b349959b54a58a9 | LaborMarketV2 合約上的交易列表 |
| 4 | https://github.com/abelcml/AI-x-Etherum-Hackthon/blob/main/docs/e2e-evidence.md | 所有 tx 的證據表 |

- 分頁 1 先按「重置当前任务」，模擬資料集選 **CSV 清洗**。
- 分頁 1 開啟時如果要求登入，帳號 `team`（密碼在群組，不要投影出來）。
- **不在台上跑鏈上指令。** 真實交易已經跑過三次，證據就在分頁 2～4；現場跑可能遇到第一次 `post` 失敗（RPC 延遲），太冒險。

---

## 0:00–0:25　問題（不切畫面，停在分頁 1 首頁）

> When you hand a task to an AI agent, you still have to check the result yourself — because the agent that did the work is also the one telling you it went well. Payment ends up depending on trust.
>
> We built a bounty flow on HSK Chain where the money is locked on-chain first, and it's released only when the result passes checks that the worker doesn't control.

## 0:25–1:15　網頁流程（分頁 1，CSV 清洗）

動作：按「模擬发布并托管赏金」→「播放模拟执行」→ 驗收情形選「交付满足全部条件」→「检查模拟验收资料」。

> Here's the workflow. The poster picks a task package — here, deduplicating a CSV — with a fixed test price and fixed acceptance rules. The bounty is escrowed, the agent delivers, and the acceptance check runs.
>
> For CSV, the check is real — it runs in the browser: same header, no id lost, no duplicates, and the output hash must match the expected answer. That last rule matters: a worker can't pass by just deleting rows.

動作：驗收情形改選「一项必要检查失败」→ 再按「检查模拟验收资料」，畫面顯示擋下付款。

> If any required check fails, payment is blocked. To be clear, the escrow on this page is simulated — the real on-chain run is next.

## 1:15–2:20　真實鏈上閉環（分頁 2 → 3 → 4）

動作：切到分頁 2（PR #10），指著綠色 `hsk-checks` 和 merged。

> This is a real run. An issue, a real pull request, CI passed, and a maintainer merged it.

動作：切到分頁 3（explorer），指著交易列表。

> On HSK testnet, our contract holds the bounty. Before the worker can submit and before the poster settles, our CLI asks GitHub two questions: was this PR merged, and did the required check pass on that exact commit? Only then does it write the commit's fingerprint on-chain and release the funds.

動作：切到分頁 4（證據表），指著「最終餘額」。

> We ran it end to end twice — worker balance went from 10 to 14 test USDC — plus a refund path where the worker missed the deadline and the escrow went back to the poster. Every step has a transaction link here.

## 2:20–2:50　差異與誠實邊界（停在分頁 4）

> We built on Handsel, an open-source agent labor market. Handsel pays as soon as a PR is merged, even if CI failed on that commit. We bind payment to the same commit that passed CI, and record that commit on-chain.
>
> Honest limits: settlement is triggered by the poster, so it's a custodial model; both wallets in our demo are ours; and we don't yet link a PR to a specific job — that's our next fix.

## 2:50–3:00　收尾

> Define the work, verify the result, settle on HSK. Thank you.

---

## QA 預備（2 分鐘）

| 可能的問題 | 回答要點 |
|---|---|
| Why blockchain? A database could hold the money. | 錢由合約托管，雙方都不能單方面拿走；超時退款是合約規則，不靠平台；付給哪個 commit 永久公開，任何人可以對照 GitHub 查證。 |
| Can the worker cheat by editing the tests? | 目前沒有擋，這是已知缺口。下一步：檢查 PR 改了哪些檔案，禁止動 `tests/` 和 `.github/`。 |
| Can someone submit someone else's PR? | 目前 PR 沒有綁到 job，是已知缺口。修法：`resultHash` 加入 jobId，並檢查 PR 內容有 `Closes #issue`。 |
| What if the poster never settles? | 合約有審核期限；期限過後可以觸發 `expireReview`。我們部署的參數是全額退回 poster，所以目前這個設計保護的是 poster，不是 worker。 |
| Where's the AI? | 目前修 code 的是外部 coding agent 或人，這次 demo 的兩個 PR 都是人寫的。我們的重點是驗收和結算層，接任何 agent 都可以。 |
| Is this a new chain or L2? | 不是。這是建在 HSK 測試網上的應用層協議，用 EVM 智能合約。 |
| What did you build vs reuse? | 合約取自 Handsel（Apache-2.0）。我們做的是：HSK 部署與 CLI、同一 SHA 付款規則、CSV 場景驗收器、任務標籤與報價、網頁前端。 |
