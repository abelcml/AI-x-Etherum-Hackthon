# 待決事項（依嚴重度）

每項格式：事實 → 推論 → 建議。**決定後請在該項下寫「決定：…（誰，時間）」。**

## Blocking

### B1. 誰是 requester？「普通錢包模式」vs「平台觸發付款」
- 事實：`LaborMarketV2.approveJob()` 有 `if (msg.sender != job.requester) revert NotRequester();`
- 推論：用戶自己的錢包發案 → 後台沒有權限替他放款。後台要自動放款 → requester 必須是平台錢包（託管）。
- 建議：demo 用平台錢包當 requester，pitch 明說「hackathon 版為託管模式」；或 merge 後由用戶手動按 approve（就不是自動觸發）。
- 決定：

### B2. 退款路徑無法在 3 分鐘 demo 內等到 timeout
- 事實：`MIN_WINDOW = 10 minutes`，所有 window（delivery / review / open / dispute）都 ≥ 10 分鐘。
- 建議：demo 前 ≥10 分鐘預先開一個「已 accept 未交件」的 job，上台直接 `reclaimJob`；或演 `cancelJob`（Open 狀態可立即退）。
- 決定：

## Important

### I1. 新意要主動講
- Handsel README 的主 demo 就是本流程。差異 = HSK 部署 + same-SHA 規則（見 handsel-review.md #1）。Pitch 第一句就講。

### I2. 「同一版本」定義到 SHA，並考慮上鏈
- 規則：比對 merge 事件裡的 `pull_request.head.sha`，**不是** `merge_commit_sha`（squash merge 會產生新 SHA）。
- 待查：Handsel 現在 `submitWork(resultHash)` 的 `resultHash` 是什麼（diff hash？）；worker 鏈上交件在建 PR 之前還是之後（之前的話 SHA 尚不存在，順序要調）。
- 決定：

### I3. CI 綠但維護者一直不 merge
- 事實：合約走 `expireReview` → requester 拿回 90%，worker 拿 10%（`SILENCE_FORFEIT_BPS`，部署時可設 0）。
- 要決定：沿用 90/10，還是部署時設 0 以符合「未完成可退款」的敘述。
- 決定：

### I4. 時間
- Handsel 的 GitHub 流程需要 GitHub App + 公開 webhook URL + 資料庫。
- 建議：用輪詢 script 取代 webhook（見 scripts/README.md）。
- 決定：

## Minor
- HSK track 是否硬性要求部署在 HashKey Chain、評分標準：Luma 頁面沒寫，需現場問主辦。
- 私有 repo 能否作為提交：未查。
