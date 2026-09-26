# AI × Ethereum Hackathon — HSK 鏈上的 AI 代碼修復懸賞

EAG Ethereum Hackathon @ Sydney（2026-09-26），目標 track：**HSK Chain**（AI Agents / Payments）。

> 狀態：骨架。合約尚未部署，端到端流程尚未跑通。實作在隊友的 `ph1gros/handsel-hsk-lite`（私有），本 repo 目前放規格、審查結論與待決事項。

## 一句話

用戶為 GitHub Issue 設懸賞，AI 修復並開 PR；**只有「同一個 commit SHA 通過 CI」且「該 PR 被維護者合併」時**，HSK 鏈上的合約才放款；否則按規則退款。

## 與 Handsel 的關係

基於 [Kairose-master/handsel](https://github.com/Kairose-master/handsel)（Apache-2.0）精簡移植。Handsel 已經有「bounty label → AI → PR → CI → merge 付款」這條流程（Base mainnet），所以我們的貢獻必須講清楚：

| | Handsel | 本專案 |
|---|---|---|
| 鏈 | Base / Base Sepolia | **HashKey Chain testnet（chain 133）** |
| 放款條件 | PR merged 即放款；`app/api/github/webhook/route.ts` merge 時直接寫 `passed: true`（"a merge outranks any grader"），**不檢查被 merge 的 SHA 是否通過 CI** | **merged PR 的 `head.sha` == 所有 check-run success 的 SHA** 才放款 |
| 鏈上可追溯 | `resultHash`（內容待確認） | 目標：`resultHash` 綁定 commit SHA，explorer 上可對照「錢付給哪個 commit」 |
| 範圍 | 信用、借貸、4337、多鏈、Office… | 單 repo、普通錢包、測試代幣，不做跨鏈/信用/完整市場 |

## 流程

```text
1. Requester 發任務，postJob() 把賞金鎖進 LaborMarketV2（HSK testnet）
2. AI worker acceptJob()，產生修復，開 PR
3. GitHub CI 對 PR head SHA 跑測試
4. 維護者 merge
5. Settler 檢查：merged && head.sha == CI 全綠的 SHA  →  approveJob()
   否則：closed unmerged → 退款路徑；超時 → reclaimJob / expireReview
```

## 分工

- **AI**：理解 issue、產生修復
- **GitHub**：代碼、PR、CI、人工 merge 記錄
- **HSK Chain**：託管賞金、付款/退款、可查交易記錄
- **後台 / settler**：串 AI、GitHub、合約

## 目錄

```text
contracts/      合約計畫（從 Handsel 取 MockUSDC / AgentCreditRegistry / LaborMarketV2）
scripts/        settler（GitHub 狀態 → 鏈上結算）計畫
docs/
  hsk-chain.md          HashKey Chain testnet 參數
  handsel-review.md     讀 Handsel code 的查證結果（附檔案位置）
  open-questions.md     尚未決定、會卡住 demo 的事項  ← 先看這個
Agents chat/    兩邊 agent 討論用的留言板
```

## Demo 目標

一條完整記錄：Issue → AI 修復 → PR → CI 通過 → 人工合併 → HSK 到帳；外加一條失敗/超時退款路徑（注意合約最短期限 10 分鐘，見 open-questions）。

## 授權

引用 Handsel 程式碼時須保留其 Apache-2.0 LICENSE/NOTICE 並標明修改。
