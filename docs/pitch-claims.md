# Pitch 可用主張清單（給隊友 C）

每句都標明可信度。**只有「已驗證」的主張能講成事實。** 截至 2026-09-26 12:00。

## 已驗證（可以直接講）

| 主張 | 證據 |
|---|---|
| 基於 Handsel（Apache-2.0），保留原授權 | `handsel-hsk-lite/LICENSE`、`hsk-core/LICENSE` |
| Handsel 原版 PR 只要被 merge 就付款，不檢查 CI 對應的版本 | 上游 `app/api/github/webhook/route.ts`：merge 時直接寫 `passed: true` |
| 我們改成「同一個 head SHA 通過指定檢查，並且被 merge」才允許結算 | `hsk-core/src/github.mjs` `verifyMergedPr`；`handsel-hsk-lite/lib/github-settlement-policy.ts` |
| 交付的 commit SHA 會寫進鏈上 `resultHash` | `hsk-core/src/proof.mjs` |
| 任務的驗收條件在接單前就封存成 `specHash` 寫上鏈 | `handsel-hsk-lite/lib/spec-hash.ts`；`hsk-core` 的 `hashJobSpec` |
| hsk-core 33 項測試通過，三個合約編譯成功 | 2026-09-26 在 Abel 的機器上實際執行 |
| CSV 去重驗收器能擋下「只交表頭」和「亂刪列」這類作弊 | `acceptance/csv-dedupe`，8 項測試 |

## 還不能講成事實（講的時候要加「待驗證」）

| 主張 | 缺什麼 |
|---|---|
| 已部署在 HSK 測試網 | 還沒部署。部署後把合約地址和 explorer 連結貼到 `contracts/README.md` |
| 端到端流程跑通 | Issue → PR → CI → merge → 鏈上到帳，還沒做過一次真實的 |
| 框架可以換到其他業務 | 只有 CSV 驗收器存在，還沒接鏈上結算 |

## 不要這樣講

- 「merge 就自動付款」：錯。結算由 requester 執行 `settle`，合約只相信 requester 的批准，是託管模式。
- 「AI 能客觀判斷品質」：只有代碼修復（CI）和 CSV（hash）是確定性驗收。翻譯、設計仍要人工確認。
- 「新的區塊鏈 / L2」：不是。這是建在 HSK 上的應用層協議。
- 「防止拿別人的 PR 領錢」：目前 PR 沒有綁到 job（見 `Agents chat/20260926-1200-...`）。修好之前不要這樣宣稱。
