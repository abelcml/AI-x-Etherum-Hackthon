# Pitch 可用主張清單（給隊友 C）

每句都標明可信度。**只有「已驗證」的主張能講成事實。** 新版通用框架位於獨立 `hsk-common-v2/` 套件，與舊版鏈上案例分開表述。

## 已驗證（可以直接講）

| 主張 | 證據 |
|---|---|
| 基於 Handsel（Apache-2.0），保留原授權 | `handsel-hsk-lite/LICENSE`、`hsk-core/LICENSE` |
| Handsel 原版 PR 只要被 merge 就付款，不檢查 CI 對應的版本 | 上游 `app/api/github/webhook/route.ts`：merge 時直接寫 `passed: true` |
| 我們改成「同一個 head SHA 通過指定檢查，並且被 merge」才允許結算 | `hsk-core/src/github.mjs` `verifyMergedPr`；`handsel-hsk-lite/lib/github-settlement-policy.ts` |
| 交付的 commit SHA 會寫進鏈上 `resultHash` | `hsk-core/src/proof.mjs` |
| 舊版任務核心條件在接單前封存成 `specHash` 寫上鏈 | `handsel-hsk-lite/lib/spec-hash.ts`；`hsk-core` 的 `hashJobSpec`；舊版未封存完整驗收規則 |
| hsk-core 36 項測試通過，三個合約編譯成功 | 2026-09-26 在 Abel 的機器上實際執行 |
| CSV 去重驗收器能擋下「只交表頭」和「亂刪列」這類作弊 | `acceptance/csv-dedupe`，8 項測試 |
| 三個合約已部署在 HSK 測試網（chain 133） | `contracts/README.md`：地址、部署 tx、鏈上讀取核對 |
| 真實端到端閉環跑通兩次：Issue → 托管 → 接單 → PR → CI → 人工 merge → 提交 → 結算 → worker 提現到帳 | `docs/e2e-evidence.md`：job 1（PR #7）、job 3（PR #10），每步都有 tx |
| 退款路徑跑通：接單後逾期未交件 → `reclaimJob` → 退回 requester | `docs/e2e-evidence.md` job 2 |
| 鏈上 `resultHash` 可以用被 merge 的 commit SHA 重算對上 | `docs/e2e-evidence.md`「鏈上核對」 |

## 本地實作完成，尚無新版鏈上交易證據

| 主張 | 本地證據與邊界 |
|---|---|
| GitHub 和 CSV 共用任務規格、驗收回執與 CLI 結算路徑 | `hsk-common-v2/src/verify.mjs`、`scripts/job.mjs` 及測試；CSV 真實測試網付款未驗證 |
| 新版 GitHub 規格封存 App ID、檢查名稱和禁止路徑，驗收要求 PR 聲明關閉 Issue | `hsk-common-v2/src/jobs.mjs`、`github.mjs` 及測試；聲明不等於真正解決 Issue |
| 新版結果哈希綁定任務、規格、GitHub PR 身份及成果 SHA | `hsk-common-v2/src/proof.mjs` 及測試；舊版鏈上任務仍使用舊哈希 |

## 還不能講成事實（講的時候要加「待驗證」）

| 主張 | 缺什麼 |
|---|---|
| CSV 任務已完成真實測試網付款 | 獨立套件的 CLI 結算路徑只有本地測試，還缺 CSV 交易與餘額證據 |
| 網頁前端（Task Commons）完成付款 | 已合併 PR #11 可讀取真實鏈上狀態和預覽交易，簽名發送仍關閉，CSV 網頁交易入口未接 |
| AI 自動寫 code | 目前由外部 coding worker 或人工完成 PR；兩次閉環的 PR 都是人寫的 |

## 講的時候要主動說明

- 兩次閉環的 requester 和 worker 是同一人操作的兩個測試錢包。
- 代幣是自己部署的 MockUSDC，沒有真實價值。

## 不要這樣講

- 「merge 就自動付款」：錯。結算由 requester 執行 `settle`，合約只相信 requester 的批准，是託管模式。
- 「AI 能客觀判斷品質」：只有代碼修復（CI）和 CSV（hash）是確定性驗收。翻譯、設計仍要人工確認。
- 「新的區塊鏈 / L2」：不是。這是建在 HSK 上的應用層協議。
- 「防止拿別人的 PR 領錢」：新版只要求 PR 聲明關閉 Issue 並綁定其身份，仍不能證明代碼確實解決任務；舊版鏈上任務沒有新增這項檢查。
