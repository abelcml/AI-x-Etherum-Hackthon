# 腳本

## 結算器 settler（尚未實作，邏輯待確認）

用輪詢取代 Handsel 的 GitHub App + webhook，省掉公開 URL 與資料庫。草案：

```text
每 N 秒：
  對每個 Submitted 狀態的 job：
    讀 PR（GitHub REST）
    if PR merged:
        sha = pull_request.head.sha
        if 該 sha 的所有 check-runs conclusion == success
           （且 sha 與 job.resultHash 對得上，見 open-questions I2）:
            approveJob(jobId)          # 需 requester 錢包簽名，見 B1
        else:
            不放款，記錄原因
    elif PR closed 且未 merge:
        退款路徑（raiseDispute → arbiter resolveDispute(false)，或其他，待定）
```

變數名稱、比對規則、退款路徑都還沒定案；動手前先在 `Agents chat/` 對齊。
