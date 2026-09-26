# 合約

合約原始碼在 `hsk-core/contracts/`，取自 Handsel（保留 Apache-2.0）。部署腳本：`hsk-core/scripts/deploy.mjs`。

## HSK 測試網部署（chain 133，2026-09-26）

部署者 / oracle / arbiter：`0x9F457e788fdf421983F343b821B6EB5B1e89D01b`（Abel，測試錢包）

| 合約 | 地址 | 部署 tx |
|---|---|---|
| MockUSDC | [`0xf586ec82ee70d4bfdd7aba5e8ee01ebe002ffcdd`](https://testnet-explorer.hskchain.net/address/0xf586ec82ee70d4bfdd7aba5e8ee01ebe002ffcdd) | [`0x90af5742…5723`](https://testnet-explorer.hskchain.net/tx/0x90af57425d0455040babef49dab29f316d0854ddfd43561e24a13066da715723) |
| AgentCreditRegistry | [`0xf8528bc9d8d059a6de42c973a88ad02c82474aee`](https://testnet-explorer.hskchain.net/address/0xf8528bc9d8d059a6de42c973a88ad02c82474aee) | [`0x76602ec9…ced1`](https://testnet-explorer.hskchain.net/tx/0x76602ec9ba5add07ac12cb837b54a3ad1a7e8e7680e6feb3b9565798ff68ced1) |
| LaborMarketV2 | [`0xf7400c17e0b48ac3166efead6b349959b54a58a9`](https://testnet-explorer.hskchain.net/address/0xf7400c17e0b48ac3166efead6b349959b54a58a9) | [`0x1b78d3e4…7e38`](https://testnet-explorer.hskchain.net/tx/0x1b78d3e42a4ab561c6c0096c39c74b4ada8918c5d63dfe9e8ed56fd2e0917e38) |

`hsk-core/.env.local` 填這三個：

```text
USDC_ADDRESS=0xf586ec82ee70d4bfdd7aba5e8ee01ebe002ffcdd
CREDIT_REGISTRY_ADDRESS=0xf8528bc9d8d059a6de42c973a88ad02c82474aee
LABOR_MARKET_ADDRESS=0xf7400c17e0b48ac3166efead6b349959b54a58a9
```

## 已驗證

- 三筆交易 receipt 都是 `success`（區塊 33601771 / 33601774 / 33601779）。
- 讀鏈上的 LaborMarketV2：`usdc()`、`registry()` 指向上面兩個合約；`arbiter()` = 部署者；`REVIEW_WINDOW()` = 600。
- `pnpm check --rpc`：RPC 與合約檢查通過。

## LaborMarketV2 參數（`deploy.mjs` 預設，immutable，不能改）

| 參數 | 值 | 意思 |
|---|---|---|
| feeBps / flatFee | 0 / 0 | 不收手續費，`postCost` = 賞金 |
| bondBps / flatBond | 0 / 0 | worker 接單不用押金 |
| min / max deliveryWindow | 600 / 86400 秒 | 交付期限 10 分鐘到 1 天 |
| reviewWindow | 600 秒 | 交件後 requester 有 10 分鐘審核 |
| maxOpenWindow | 3600 秒 | 沒人接的任務 1 小時後可退 |
| disputeWindow | 600 秒 | |
| silenceForfeitBps | 0 | requester 不審核、放到期限過去，**全額退回** requester |
| minBounty | 1（= 0.000001 USDC） | |

Explorer：`testnet-explorer.hskchain.net` 可以打開；`testnet-explorer.hsk.xyz`（`handsel-hsk-lite` 設定用的）目前連不上。
