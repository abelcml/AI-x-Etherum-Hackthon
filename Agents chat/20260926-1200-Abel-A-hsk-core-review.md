# hsk-core 審查：測試屬實；PR 與任務沒有綁定

回覆：`hsk-core/`（PR #2，`60cf99c`）
作者：Abel（隊友 A）的 Claude
要對方決定：第 2 點要不要在 demo 前修（ph1gros）

## 1. 已驗證

- 在 Node 24 本地執行 `node --test tests/*.test.mjs`：**33/33 通過**。
- `node scripts/compile.mjs`：三個合約以 solc 0.8.24 編譯成功。
- 沒有部署，也沒有送出任何交易。

## 2. 重要：PR 沒有綁到 issue、worker 或 job（已讀 code 確認）

**事實**
- `scripts/job.mjs` `verifiedPullRequest()` 只檢查三件事：PR 屬於同一個 repo、已 merge、必需檢查通過。
- `record.spec.issue` 只存下來，沒有拿來比對。
- 沒有檢查 PR 作者是不是接單的 worker。
- `src/proof.mjs` `hashPrResult(repo, prNumber, headSha)` 的內容不包含 jobId。

**推論**
- worker 可以拿 repo 裡**任何一個已 merge、檢查全綠的 PR**（例如維護者自己的 PR）提交給任何一個 job。requester 執行 `settle` 時驗證會通過，就會付款。
- 同一個 PR 可以重複提交給同一個 repo 的兩個 job，兩邊都能結算。

**建議**（改動小，由 ph1gros 決定）
- `resultHash` 加入 jobId，例如 `["handsel-hsk-pr-v2", jobId, repo, pr, headSha]`，擋掉跨 job 重用。
- `verifiedPullRequest` 檢查 PR 的 body 或標題含有 `#<issue>`（或 `Closes #<issue>`），擋掉拿無關 PR 冒充。
- demo 只跑一個 job 的話不會觸發這個問題，但評審問「怎麼防止拿別人的 PR 領錢」時要有答案。

## 3. pitch 措辭提醒

- `settle` 是 requester 自己執行的 CLI 指令，合約只相信 requester 的 `approveJob`。
- 所以「同一 SHA 通過 CI + merge 才付款」保護的是 **requester**，讓他不會錯付。它不保證 worker 一定拿得到錢：requester 不執行 settle 的話，worker 只能等 `expire-review`，拿到 10%。
- README 寫「发布者确认结算」是正確的。pitch 不要說成「merge 自動觸發付款」。
