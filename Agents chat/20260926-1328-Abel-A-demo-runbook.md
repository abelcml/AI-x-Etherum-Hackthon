# 給托管 Task Commons 的隊友：已跑通的 demo 操作（照做即可）

回覆：PR #11（Task Commons 真實模組）
作者：Abel（隊友 A）的 Claude
要對方做的事：照第 1 節更新托管端；簡化網頁時，保留第 3 節列出的已驗證操作

## 1. 托管端要做的更新（約 2 分鐘）

1. `git pull`，目前 main 在 `d903a42` 或更新。
2. **補上 job 記錄**：把 `docs/job-records/1.json`、`2.json`、`3.json` 複製到 `hsk-core/.data/jobs/`。只含公開資訊，不含私鑰。沒有這三個檔案時，依賴本地記錄的功能會報「本地找不到任务 N 的 GitHub 绑定记录」。
3. `.env.local` 確認有下面三行（`.env.commons.example` 已經有）：
   ```dotenv
   GITHUB_REPOSITORY=abelcml/AI-x-Etherum-Hackthon
   GITHUB_CHECK_APP_ID=15368
   GITHUB_REQUIRED_CHECKS=hsk-checks
   ```
4. **重啟**服務：`node --env-file-if-exists=.env.local scripts/commons.mjs`（在 `hsk-core` 目錄）。不重啟的話，看不到新的 `/demo` 頁。

## 2. 簡化頁 `/demo`（已驗證可用，可以直接拿去改）

- 檔案：`hsk-core/web/commons/demo.html`、`demo.js`、`demo.css`；`scripts/commons.mjs` 的 `staticPaths` 多了三條白名單。
- **注意 CSP**：伺服器送出 `script-src 'self'; style-src 'self'`，**內聯的 `<script>`、`<style>`、`onclick=` 都會被擋**。改頁面時 JS / CSS 一定要放在獨立檔案，並加進 `staticPaths`。第一版就是因為這樣按鈕全部沒反應。
- 只讀：只呼叫 `/api/config`、`/api/jobs`、`/api/jobs/:id`、`/api/pr`、`/api/verify`、`/api/csv`，沒有交易按鈕。

## 3. 已驗證能跑通的操作（2026-09-26 13:20，本機 127.0.0.1:4174）

| # | 操作 | 輸入 | 實際結果 |
|---|---|---|---|
| 1 | 讀鏈上狀態（`GET /api/jobs/3`） | job `3` | `Completed`，bounty `2 USDC`，resultHash `0x3cd7ccb5…4f07` |
| 2 | 讀 PR 身份（`POST /api/pr`） | PR `10` | headSha `e3a7b19f2809df247535aaf06062deb684763f73`，merged `true` |
| 3 | **真實驗收**（`POST /api/verify`；原頁按鈕「真实验收」） | PR `10` + 上面的 SHA | `merged:true`，`pr_head_sha == ci_sha`，`hsk-checks = success`，`verified:true`，`result_hash = 0x3cd7ccb5…4f07`（**與鏈上 job 3 相同**） |
| 4 | 錯誤 SHA | PR `7` + 全 0 SHA | 被拒：`Pull request head SHA does not match the expected SHA` |
| 5 | CSV 正確交付（`POST /api/csv` run → verify） | 內建 sample，key `id` | `passed:true`，四條規則全過，expected `bfe13e8e…0173` |
| 6 | CSV 刪一列 | 刪 id=5 | `passed:false`，規則 2（id 集合）與規則 4（hash）失敗 |

job 1（PR `7`，SHA `959d86d0…`）同樣可以用來展示第 1～3 項。

## 4. 不要在 demo 按的按鈕

- 「**预览提交结果哈希**」：只適用於 `Accepted` 狀態的任務。job 1、3 已經 `Completed`，按了會報「提交工作 要求任务状态 Accepted，当前为 Completed」。這是正確的保護，不是 bug，但在台上看起來像壞掉。
- 任何「确认发送」：已經結算過的 job 再送只會失敗；新的交易也要先確認托管端有開簽名、有錢包。

## 5. 真實交易證據

全部的 tx 在 `docs/e2e-evidence.md`：job 1、3 成功閉環（worker 10 → 14），job 2 逾期退款。這些交易由 CLI 送出，不是網頁送出的；講的時候不要說成「網頁發起的交易」。
