# 執行與驗收（原隊友 B 範圍，由 A 一併負責）

接在 `docs/task-labels.md` 之後：任務發布後，誰執行、交什麼、怎麼判定完成、交給結算什麼。

## 1. 兩個場景的現況

| 場景 | 執行器 | 驗收器 | 狀態 |
|---|---|---|---|
| 代碼修復 | 外部 coding worker 開 PR | `hsk-core/src/github.mjs` `verifyMergedPr`：PR 已 merge、head SHA 等於預期、指定 App 的必需檢查全部 success | ph1gros 已實作（分支 `handsel-hsk-implementation`，PR #2 未 merge），自述 33 項本地測試通過，未上鏈 |
| CSV 去重 | `acceptance/csv-dedupe/cli.mjs run`（參考執行器，代表 AI worker 的正確答案） | `acceptance/csv-dedupe/cli.mjs verify` | 本地 8 項測試通過；**未接鏈上結算** |

## 2. 結果欄位表（worker 交件時提供）

| 欄位 | 代碼修復 | CSV 去重 |
|---|---|---|
| 任務編號 | 是 | 是 |
| 運行編號 | 一次嘗試一個 | 同左 |
| 產物 | PR 編號 | 輸出 CSV 連結 |
| 產物版本 | PR head SHA（40 碼） | 輸出 CSV 的 sha256（標準化後，見第 4 節） |
| 鏈上 `resultHash` | `keccak(["handsel-hsk-pr-v1", repo, pr, headSha])`（`hsk-core/src/proof.mjs`） | 建議：`keccak(["handsel-hsk-csv-v1", taskId, outputSha256])`（**未實作**） |

## 3. 驗收欄位表（驗收器輸出）

| 欄位 | 說明 |
|---|---|
| 任務編號 / 產物版本 | 驗的是哪一個版本 |
| 結果 | 通過 / 失敗 / 待確認（例：CI 尚未跑完） |
| 失敗原因 | 列出違反哪幾條規則 |
| 證據 | 代碼修復：check-run id 與連結；CSV：`outputSha256` 與預期 hash |
| 驗收者 | 哪個程式 / 哪把錢包執行 |

**驗收結果只是事實，不直接動錢。** 結算由持 requester 錢包的一方依結果呼叫合約，這是託管模式，pitch 時照實說。

## 4. CSV 驗收的四條規則（實作於 `acceptance/csv-dedupe/csv-dedupe.mjs`）

1. 表頭與輸入相同
2. 輸出 id 集合 = 輸入 id 集合（擋「只交表頭」和「亂刪列」）
3. 輸出 id 無重複
4. 輸出的 sha256 = 發布者事先公布的預期 hash（擋「保留最後一筆」等不同答案）

hash 對「標準化後」的內容計算：LF 換行、結尾一個換行，所以 CRLF 與 LF 判定相同。範圍：逗號分隔、UTF-8、第一列為表頭、**不處理帶引號的欄位**。

範例（`sample.csv`，key = `id`）：

```sh
cd acceptance/csv-dedupe
node cli.mjs expected sample.csv id
# bfe13e8e1f31c746f933354a6f3e33190397c9e664cb896d9db5bcb1fefa0173
node cli.mjs run sample.csv id out.csv
node cli.mjs verify sample.csv out.csv id bfe13e8e1f31c746f933354a6f3e33190397c9e664cb896d9db5bcb1fefa0173
node --test
```

## 5. 尚未解決

- 代碼修復的「禁止修改路徑」（`tests/`、`.github/`）：`verifyMergedPr` 目前沒有檢查 PR 改了哪些檔案。已在留言板建議 ph1gros。
- CSV 場景的鏈上結算：`resultHash` 格式只是建議，沒有接 `hsk-core` 的 `job submit`。
