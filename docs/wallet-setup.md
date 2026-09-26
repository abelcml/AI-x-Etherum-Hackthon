# 錢包與 HSK 測試幣設定

**不需要在 HashKey 註冊帳號。** 測試網只需要一個瀏覽器錢包，加上 faucet 發的測試 HSK（付 gas 用）。賞金用的 MockUSDC 由部署者用 `hsk-core` 的 `mint` 指令發放，不從 faucet 領。

> 只用全新的測試錢包。私鑰只放在自己電腦的 `.env.local`，不要貼進聊天，也不要 commit。

## 1. 安裝 MetaMask

1. 打開 **metamask.io**，點 Download，安裝 Chrome 擴充功能。辨認方式：狐狸 logo。
2. 選「Create a new wallet」，設密碼，抄下 12 個助記詞（離線保存）。
3. 如果之前就有錢包，另外新建一個帳戶專門測試：點右上帳戶選單 → Add account。

## 2. 加入 HashKey Chain 測試網

MetaMask → 左上網路選單 → Add network → Add a network manually：

| 欄位 | 值 |
|---|---|
| Network name | HSKChain Testnet |
| RPC URL | https://testnet.hsk.xyz |
| Chain ID | 133 |
| Currency symbol | HSK |
| Block explorer | https://testnet-explorer.hskchain.net |

來源：chainid.network 登記的 chain 133（名稱 `HSKChain Testnet`、explorer `testnet-explorer.hskchain.net`）。名稱要照登記的填，否則 MetaMask 會警告。`handsel-hsk-lite/lib/onchain/config.ts` 用的 explorer 是 `testnet-explorer.hsk.xyz`，兩者是否都能開沒有核對。

## 3. 領測試 HSK

1. 打開 **faucet.hsk.xyz/faucet**（HashKey 官方 docs 列出的 faucet）。
2. 用 MetaMask 連接，或貼上錢包地址，按領取。
3. 回 MetaMask 切到 HashKey Chain Testnet，確認 HSK 餘額大於 0。
4. faucet 可能有領取次數限制。要更多的話，官方另有 Sepolia → HSK testnet 的 bridge：testnet-bridge.hashkeychain.net。

## 4. 誰需要錢包

| 角色 | 需要測試 HSK | 需要 MockUSDC | 用在 `hsk-core` 哪個設定 |
|---|---|---|---|
| 部署者 | 是 | 否 | `DEPLOYER_PRIVATE_KEY` |
| requester（發懸賞） | 是 | 是（賞金 + 手續費） | `REQUESTER_PRIVATE_KEY` |
| worker（接單） | 是 | 是（接單押金） | `WORKER_PRIVATE_KEY` |

MockUSDC：部署完成後，由部署者對 requester 和 worker 的地址執行 `pnpm mint --to <地址> --amount 10 --send`。

匯出私鑰給 CLI 用：MetaMask → 帳戶選單 → Account details → Show private key。**只放進自己的 `.env.local`。**
