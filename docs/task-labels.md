# 標籤、報價與任務定義（隊友 A）

負責範圍：「用戶下單之前」。對應 `docs/PROJECT-BRIEF.md` 第 6 節隊友 A 的三項交付：

1. 標籤與報價表
2. 任務欄位表
3. 兩個填好的任務範例

> 本文件是**設計**，不代表 code 已實作。所有金額皆為**測試報價**（MockUSDC，記為 tUSDC），不代表市場公允價格。

## 0. 與現有 code 的對應（已查證）

| 設計概念 | 鏈上 / code 對應 | 來源 |
|---|---|---|
| 驗收條件接單前固定 | `title, description, acceptanceCriteria, testCode, deliverableKind, requiredCapabilities, testSuiteSlug` 依固定順序封存為 `specHash`，`postJob` 寫上鏈 | `handsel-hsk-lite/lib/spec-hash.ts` |
| 價格 | 鏈上 `bounty`（`postJob` 參數） | `contracts/src/LaborMarketV2.sol` |
| 期限 | `deliveryWindow`，**下限 10 分鐘**（`MIN_WINDOW = 10 minutes`） | 同上 |
| 發案實際成本 | `postCost(bounty)` = 賞金 + 手續費 | 同上 |
| 接單押金 | worker 須押 `bondFor(bounty)` | 同上 |

**標籤本身不在封存欄位內。** 為了不改 code 也能讓標籤被封存，規定標籤以固定格式寫在 `description` 第一行（見第 2 節）。

## 1. 標籤維度

一個任務的標籤由五個維度組成，**每一維都必須在下單當下可量測**，避免事後對範圍有爭議。

| 維度 | 意義 | 取值範例 | 量測方式 |
|---|---|---|---|
| 場景 `type` | 做什麼 | `code-fix`、`csv-dedupe` | 選單 |
| 規模 `size` | 多大 | `S`、`M` | 代碼：改動檔案數；CSV：輸入列數 |
| 交付格式 `deliverable` | 交什麼 | `pr`、`csv` | 選單 |
| 驗收類型 `verify` | 怎麼判定完成 | `deterministic`（確定性）、`human`（人工） | 由場景決定 |
| 期限 `window` | 多久內交 | `30m` | ≥ 10 分鐘 |

原則：**標籤決定服務範圍與報價依據，不取代驗收。** 驗收類型為 `human` 的場景（翻譯、設計等）不宣稱可自動判定品質。

## 2. 標籤與報價表（測試報價）

| 套餐 | 範圍 | 測試報價 | 期限 | 驗收 |
|---|---|---|---|---|
| `code-fix/S` | 已有一個失敗中的測試；改動 ≤ 1 個檔案 | 2 tUSDC | 30 分鐘 | 指定必需檢查名全部通過 + 同一 head SHA 被 merge；不得修改禁止路徑 |
| `code-fix/M` | 改動 ≤ 3 個檔案，並補 1 個測試 | 5 tUSDC | 60 分鐘 | 同上；另外新增的測試必須在修復前失敗、修復後通過 |
| `csv-dedupe/S` | 輸入 ≤ 1,000 列 | 0.5 tUSDC | 10 分鐘 | 輸出檔 hash = 預期結果 hash |
| `csv-dedupe/M` | 輸入 ≤ 10,000 列 | 1 tUSDC | 20 分鐘 | 同上 |

- 報價為固定套餐，發布者確認最終價格；不做動態定價。
- 手續費與 worker 押金另計，以合約 `postCost` / `bondFor` 為準。
- 標籤、價格、驗收條件在接單前固定；要修改必須重新發布（新的 `specHash`）。

`description` 第一行的標籤格式：

```text
[labels] type=code-fix size=S deliverable=pr verify=deterministic window=30m
```

## 3. 任務欄位表（共同任務模板）

| 欄位 | 必填 | 說明 | 對應封存欄位 |
|---|---|---|---|
| 任務編號 | 是 | 例 `demo-001` | —（DB） |
| 標題 | 是 | 一句話 | `title` |
| 標籤 | 是 | 第 1 節五個維度 | `description` 第一行 |
| 任務說明 / 輸入 | 是 | issue 連結、輸入檔連結與其 hash | `description` |
| 驗收規則 | 是 | 可機器判定的條件清單 | `acceptanceCriteria` |
| 禁止修改路徑 | code-fix 必填 | 例 `tests/`、`.github/` | `acceptanceCriteria` |
| 必需檢查名 | code-fix 必填 | 須與 `HSK_REQUIRED_CHECK_NAMES` 一致 | `acceptanceCriteria` |
| 預期結果 hash | csv 必填 | 發布者事先算好的正確輸出 hash | `acceptanceCriteria` |
| 交付格式 | 是 | `pr` / `csv` | `deliverableKind` |
| 價格 | 是 | tUSDC | 鏈上 `bounty` |
| 代幣與鏈 | 是 | MockUSDC @ HSK testnet (133) | 部署設定 |
| 期限 | 是 | ≥ 10 分鐘 | 鏈上 `deliveryWindow` |

## 4. 範例一：代碼修復（`code-fix/S`）

```text
任務編號：demo-code-001
標題：修正 parse_date 對 ISO 週日期回傳錯誤
description：
  [labels] type=code-fix size=S deliverable=pr verify=deterministic window=30m
  Issue：<demo repo>#<n>。tests/test_dates.py::test_iso_week 目前失敗。
acceptanceCriteria：
  1. 必需檢查 <HSK_REQUIRED_CHECK_NAMES> 在 PR head SHA 上全部 success
  2. 維護者 merge 的 PR head SHA 與第 1 點相同
  3. diff 不得修改 tests/ 與 .github/ 下任何檔案
  4. diff 改動 ≤ 1 個檔案
deliverableKind：pr
價格：2 tUSDC（測試報價）
期限：30 分鐘
```

## 5. 範例二：CSV 去重（`csv-dedupe/S`）

```text
任務編號：demo-001
標題：依 id 去重 sample.csv
description：
  [labels] type=csv-dedupe size=S deliverable=csv verify=deterministic window=10m
  輸入：sample.csv（<連結>，sha256=<hash>，≤ 1,000 列）
  規則：同一 id 只保留「第一次出現」的那一列；保留原欄位與原順序。
acceptanceCriteria：
  1. 輸出欄位集合與順序 = 輸入
  2. 輸出 id 集合 = 輸入 id 集合（不得刪掉任何 id）
  3. 輸出中 id 無重複
  4. 輸出檔 sha256 = <預期結果 hash>（發布者事先依上述規則計算）
deliverableKind：csv
價格：0.5 tUSDC（測試報價）
期限：10 分鐘
```

## 6. 對原共同樣例的修正

`docs/PROJECT-BRIEF.md` 第 7 節原樣例的驗收是「id 無重複、字段未丟失」。

- **問題**：一份只有表頭、沒有資料列的 CSV 也能通過；worker 任意刪列同樣通過。而且「保留哪一筆」沒規定，正確答案不唯一。
- **修正**：加上「輸出 id 集合 = 輸入 id 集合」與「保留第一次出現」規則。這樣正確答案唯一，驗收可以直接比對 hash（第 5 節第 2、4 條）。

代碼修復的對應風險：worker 修改測試或 workflow 讓檢查輕易通過。因此加入「禁止修改路徑」欄位。**現有 code 是否實際擋下這類 diff，尚未查證**（見 `Agents chat/` 留言）。
