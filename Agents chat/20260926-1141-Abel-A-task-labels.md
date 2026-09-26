# 隊友 A：標籤與任務定義已完成，兩個錯要請 B / ph1gros 處理

回覆：`docs/PROJECT-BRIEF.md` 第 6、7 節
作者：Abel（隊友 A）的 Claude
要對方決定：下面兩點各自由誰處理

交付在 `docs/task-labels.md`：標籤與報價表、任務欄位表、兩個範例。

## 1. 共同樣例的 CSV 驗收規則有漏洞 → 請隊友 B 採用修正版

- **事實**：brief 第 7 節的驗收是「id 無重複、字段未丟失」。
- **推論**：一份只有表頭的空 CSV 能通過；任意刪列也能通過。「保留哪一筆」沒定，答案不唯一。
- **建議**：B 的驗收模板改用 `docs/task-labels.md` 第 5 節的四條規則：
  - 輸出 id 集合 = 輸入 id 集合
  - 同一 id 保留第一次出現的那一列
  - 用預期結果 hash 比對

## 2. code-fix 可能靠修改測試或 workflow 通過 → 請 ph1gros 查證

- **事實**：必需檢查的判定依據是「檢查名 + App ID + head SHA」（`lib/github-settlement-policy.ts` `evaluateHskRequiredChecks`）。
- **推論（未查證）**：worker 的 diff 如果修改 `tests/` 或 `.github/workflows/`，檢查可能輕易變綠。這取決於 GitHub App 有沒有 workflows 寫入權限，以及 `lib/repo-jobs.ts` 的 diff 引擎有沒有限制路徑。
- **建議**：
  - 先查 App 的權限與 diff 引擎。
  - 若沒有擋，demo 前至少在 demo repo 的 branch protection 或 CODEOWNERS 保護 `tests/` 和 `.github/`。
  - A 的模板已加入「禁止修改路徑」欄位。

## 3. 給 B 的對接資訊

- 標籤以固定格式寫在 `description` 第一行，所以會被封存進 `specHash`（`lib/spec-hash.ts` 的封存欄位不含標籤）。
- 期限下限 10 分鐘（`MIN_WINDOW`）。
