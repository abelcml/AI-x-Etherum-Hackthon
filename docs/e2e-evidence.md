# 端到端閉環證據（HSK 測試網，2026-09-26）

一次真實的完整閉環：Issue → 發布並托管獎勵 → 接單 → 真實 PR → CI → 人工合併 → 提交結果 → 結算 → worker 提現到帳。

所有交易都可以在 explorer 查：`https://testnet-explorer.hskchain.net/tx/<hash>`

## 角色

| 角色 | 地址 |
|---|---|
| requester（發案、結算） | `0x9F457e788fdf421983F343b821B6EB5B1e89D01b` |
| worker（接單、交件、提現） | `0xF8135aA22175b4f30D1871eDA92bd21D7fE01Ef8` |

兩個都是 Abel 的測試錢包（同一人扮演兩個角色）。合約會擋「完全相同的地址」接自己的單（`SelfWork`），但分不出兩個地址是不是同一個人。

## job 1：成功付款

| # | 步驟 | 證據 |
|---|---|---|
| 0 | mint 10 tUSDC 給兩個角色 | [`0xb06ace86…`](https://testnet-explorer.hskchain.net/tx/0xb06ace867218aa18a651e233a68ae67bd8e6f6b20f607ad8786c8c8afcc57a13)、[`0xbab6c763…`](https://testnet-explorer.hskchain.net/tx/0xbab6c763843b035a49b8d1f86b424839d65a2d5a90e808d0eee880984deb0c9e) |
| 1 | Issue | [#6](https://github.com/abelcml/AI-x-Etherum-Hackthon/issues/6) |
| 2 | 發布並托管 2 tUSDC（`postJob`） | [`0xb2d9fdca…`](https://testnet-explorer.hskchain.net/tx/0xb2d9fdca159c3929b1971fe36d95ab207c2f11f8a00cd7c8163733c342c64dce) |
| 3 | worker 接單（`acceptJob`） | [`0x8b547cd1…`](https://testnet-explorer.hskchain.net/tx/0x8b547cd1a9f266bfbbfff89ace7f374fe91967b7d361a2a61ab0866dbb55d69e) |
| 4 | 真實 PR | [PR #7](https://github.com/abelcml/AI-x-Etherum-Hackthon/pull/7)，head SHA `959d86d041b6859a07b17030447736d3bcb0b2ae` |
| 5 | CI `hsk-checks`（github-actions，App ID 15368）通過 | [run](https://github.com/abelcml/AI-x-Etherum-Hackthon/actions/runs/36212631180/job/108322215362) |
| 6 | 人工合併 | Abel 在 GitHub 按下 merge |
| 7 | worker 提交結果（`submitWork`）：CLI 先向 GitHub API 核驗「已合併 + 同一 SHA 上 `hsk-checks` 成功」才送出 | [`0x8bc126af…`](https://testnet-explorer.hskchain.net/tx/0x8bc126af51a8d29d0d1e65aae555fe8fb40e519add3ad6c52321ba8a747e4e80) |
| 8 | requester 結算（`approveJob`）：再核驗一次 | [`0x7ec311a3…`](https://testnet-explorer.hskchain.net/tx/0x7ec311a30086580044771034b3d3b87de123e2c500cb17e97361d6847ab80d13) |
| 9 | worker 提現（`withdraw`） | [`0x2076388c…`](https://testnet-explorer.hskchain.net/tx/0x2076388c2d13fbdee9bd5b981253cf5206758dc930e709e9eb579167a5b95ab4) |

## 鏈上核對（讀合約，非 CLI 自述）

- job 1 狀態：`Completed`。
- 鏈上 `resultHash` = `0xfcae1062…48be`。用 PR #7 的 head SHA 重算 `keccak(["handsel-hsk-pr-v1", "abelcml/ai-x-etherum-hackthon", 7, "959d86d0…"])` 得到**相同的值**，所以鏈上記錄可以對回被合併的那個 commit。
- MockUSDC 錢包餘額：worker 從 10 → **12**（+2 賞金）；requester 從 10 → **7**（−2 給 job 1、−1 鎖在 job 2）。

## job 2：退款路徑（逾期未交件 → 退款）

| # | 步驟 | 證據 |
|---|---|---|
| 1 | 12:45 發布 1 tUSDC，交付期限 600 秒 | [`0xabb94f05…`](https://testnet-explorer.hskchain.net/tx/0xabb94f051e55c30420a0398d709e211bea32f273b2c15e34e01c03741c2317e0) |
| 2 | worker 接單，但故意不交件 | [`0xc0178178…`](https://testnet-explorer.hskchain.net/tx/0xc0178178d6d2539540657ffe9d898db33fcb25c886621d9df7a46c40a8a6de58) |
| 3 | 12:55 期限過後 `reclaimJob`，狀態變成 `Refunded` | [`0x2935e356…`](https://testnet-explorer.hskchain.net/tx/0x2935e3565072550fbd039831570c0ba050eb54ce2114f8714a851ac18f27be1c) |
| 4 | requester 提現退款 | [`0x755530ce…`](https://testnet-explorer.hskchain.net/tx/0x755530ce182f5c2f270d6f1539ce00f4a1dcf35b1bf57183c2ff82fe414df01a) |

## job 3：第二次成功閉環（Abel 親手操作 GitHub）

Abel 自己開 issue、在網頁上改檔案、開 PR、merge；鏈上步驟由 CLI 執行。

| # | 步驟 | 證據 |
|---|---|---|
| 1 | Issue | [#9](https://github.com/abelcml/AI-x-Etherum-Hackthon/issues/9) |
| 2 | 發布 2 tUSDC | [`0x050a3786…`](https://testnet-explorer.hskchain.net/tx/0x050a37867a5e3f2f442f2bdeb42cbc50f652fad3ac79b0ec4ecf08f16e6d55a0) |
| 3 | 接單 | [`0x87a822de…`](https://testnet-explorer.hskchain.net/tx/0x87a822de54d6e9a43a0a0e4917f862d979863ceef272819c8d46ca3cff01992b) |
| 4 | PR + CI + 人工 merge | [PR #10](https://github.com/abelcml/AI-x-Etherum-Hackthon/pull/10)，head SHA `e3a7b19f2809df247535aaf06062deb684763f73`，`hsk-checks` pass |
| 5 | 提交結果 | [`0xffdefd2e…`](https://testnet-explorer.hskchain.net/tx/0xffdefd2e3eda6fbe6758b950916655efbde037b5d5779c9b5e4f45f13c84853b)，`resultHash` `0x3cd7ccb5…4f07` |
| 6 | 結算 | [`0x39ba44ac…`](https://testnet-explorer.hskchain.net/tx/0x39ba44acd76b95f9810fadcbb02e24f6205140b8336ef65992ae4c1cc60ae22b) |
| 7 | worker 提現 | [`0xa4f8875d…`](https://testnet-explorer.hskchain.net/tx/0xa4f8875db4ada38f375205533739ae4f568574e0323fec5f0bdb19bc16fd6a78) |

## 最終餘額（讀 MockUSDC 合約）

| | 起始 | job 1 | job 2 | job 3 | 最終 |
|---|---|---|---|---|---|
| requester | 10 | −2 | −1 +1（退款） | −2 | **6** |
| worker | 10 | +2 | 0 | +2 | **14** |

合約內兩者可領取餘額皆為 0。

## 已知限制（這次閉環沒有擋、也沒測到）

- PR 沒有綁到 issue 或 job：CLI 不檢查 PR 是否對應 Issue #6（見 `Agents chat/20260926-1200-...`）。
- 沒有「禁止修改測試 / CI 檔案」的檢查。
- 結算是 requester 自己執行 CLI，屬於託管模式；合約只相信 requester 的 `approveJob`。
- 兩次 `post` 的第一次嘗試都因 `TransferFailed` 失敗，重試就成功。推測是 approve 之後 RPC 讀到的狀態還沒更新。旁證：requester 提現交易 receipt 已是 success 後，緊接著讀餘額仍是舊值，稍後再讀才正確。
