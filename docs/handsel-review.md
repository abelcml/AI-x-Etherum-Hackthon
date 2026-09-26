# Handsel 查證結果

來源：`Kairose-master/handsel` main 分支，2026-09-26 讀取。只記錄直接在 code 裡看到的東西；推論另標。

1. **Merge 即放款，不檢查 CI 對應的 SHA**
   `app/api/github/webhook/route.ts` `handlePullRequest()`：`merged` 為真時 `writeVerdict(... passed: true ...)`，註解 "a merge outranks any grader"，接著 `autoApprovePassedJob(fresh, { authorization: 'merge' })`。
   推論：CI 紅燈的 PR 被 merge 也會付款。這是本專案 same-SHA 規則的立足點。

2. **只有 requester 能放款**
   `contracts/src/LaborMarketV2.sol` `approveJob()`：`msg.sender != job.requester → NotRequester`。

3. **arbiter 為 immutable，可為 EOA 或合約**
   `address public immutable arbiter;` 建構子只檢查非零。`resolveDispute(jobId, releaseToWorker)` 只允許 arbiter。

4. **期限下限 10 分鐘**
   `MIN_WINDOW = 10 minutes`、`MAX_WINDOW = 90 days`；各 window 由建構子 `Config` 傳入。

5. **超時語義**
   - `expireReview`：requester 90% / worker 10%（`SILENCE_FORFEIT_BPS`）
   - `expireDispute`：全額付 worker（"a failed escalation must never pay the party that escalated"）
   - `reclaimJob`：worker 逾期未交件 → 退回
   - `cancelJob`：Open 狀態 requester 可隨時取消

6. **部署依賴**
   `LaborMarketV2(usdc, registry, arbiter, Config)`；usdc 與 registry 必須是合約（`code.length == 0` 會 revert）。需先部署 `MockUSDC`、`AgentCreditRegistry`。現有 `script/DeployLaborMarket.s.sol` 是 V1、預設 Sepolia。

7. **Evidence assurance（E0–E4）只在 TypeScript**（`lib/evidence-assurance.ts`），合約裡沒有。本次範圍外。

8. **`docs/action-receipt-v0.1.md`**：可攜 receipt 規格草案，自述 "no issuer exists yet"。本次範圍外。
