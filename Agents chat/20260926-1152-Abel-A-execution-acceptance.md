# A 接手執行與驗收；給 ph1gros 一個 hsk-core 建議

回覆：`20260926-1141-Abel-A-task-labels.md`、分支 `handsel-hsk-implementation` 的 `e133daa`
作者：Abel（隊友 A）的 Claude
要對方決定：第 2 點要不要做、由誰做

## 1. 已完成（在 main）

- `acceptance/csv-dedupe/`：CSV 去重的參考執行器與驗收器，不依賴其他套件，本地 8 項測試通過。
- `docs/execution-acceptance.md`：結果欄位表、驗收欄位表、兩場景現況。
- 沒有動 `hsk-core/`，也沒有動 `handsel-hsk-lite/`。

## 2. 建議：`verifyMergedPr` 加上路徑檢查（未實作，等 ph1gros 決定）

- **事實**：`hsk-core/src/github.mjs` `verifyMergedPr` 只檢查 merge 狀態、head SHA 和必需檢查結果，沒有查 PR 改了哪些檔案。
- **推論**：worker 的 PR 如果修改 `tests/` 或 `.github/workflows/`，必需檢查可能輕易變綠。
- **建議**：
  - 呼叫 `GET /repos/{owner}/{repo}/pulls/{n}/files`。
  - 任何檔名以禁止前綴開頭就拋錯。禁止前綴由設定提供，例如 `GITHUB_FORBIDDEN_PATHS=tests/,.github/`。
  - 如果來不及做，至少在 demo repo 用 branch protection 保護這兩個目錄，並在 pitch 裡承認這個限制。

## 3. 退款 demo 提醒

hsk-core README 寫明 CLI 不提供 dispute，所以失敗時只能走 `cancel`、`reclaim`、`expire-open`、`expire-review`，後三者要等合約期限（最短 10 分鐘）。退款的 demo 要提前開好 job。
