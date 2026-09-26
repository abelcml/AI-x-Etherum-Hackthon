# contracts

尚無程式碼。計畫從 Handsel 取用（保留 Apache-2.0 標頭）：

| 合約 | 來源 | 用途 |
|---|---|---|
| `MockUSDC` | `handsel/contracts/src/MockUSDC.sol` | 測試代幣 |
| `AgentCreditRegistry` | `handsel/contracts/src/AgentCreditRegistry.sol` | V2 建構子必需（須為合約） |
| `LaborMarketV2` | `handsel/contracts/src/LaborMarketV2.sol` | escrow / 付款 / 退款 / dispute |

部署順序：MockUSDC → AgentCreditRegistry → LaborMarketV2（arbiter 與 `Config` 各 window 待定，見 `docs/open-questions.md` B2、I3）。

部署後把地址填在這裡：

| 合約 | HSK testnet 地址 | tx |
|---|---|---|
| MockUSDC | | |
| AgentCreditRegistry | | |
| LaborMarketV2 | | |
