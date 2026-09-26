# HSK 精简版配置与交接清单

当前实现位于 `hsk-core/`。早期 `handsel-hsk-lite/` 为完整参考实现；本清单取代此前要求数据库、GitHub App 后台、HTTPS webhook 的清单。

## 已交付

- 三个原有合约和 HSK 测试网 133 部署脚本。
- 发布、接单、提交 PR、验收、结算、提现 CLI。
- GitHub 合并状态、提交 SHA、指定 App 的必需检查核验。
- 本地测试及合约编译验证；未完成真实链上联调。

## 组员提供

| 配置 | 内容 |
|---|---|
| USDC_ADDRESS | MockUSDC 测试代币合约地址 |
| CREDIT_REGISTRY_ADDRESS | AgentCreditRegistry 地址 |
| LABOR_MARKET_ADDRESS | LaborMarketV2 地址 |
| REQUESTER_PRIVATE_KEY | 发布者测试钱包私钥，仅本人本地填写 |
| WORKER_PRIVATE_KEY | 工作者测试钱包私钥，仅本人本地填写 |
| GITHUB_REPOSITORY | 演示仓库 owner/repo |
| GITHUB_TOKEN | 私仓 PR 与 Checks 读取权限令牌，仅本地填写 |
| GITHUB_CHECK_APP_ID | 检查来源 App 的数字 ID，例如实际运行 CI 的 App；不是新建服务端 |
| GITHUB_REQUIRED_CHECKS | 验收要求的 check-run 名称，英文逗号分隔 |

部署由负责钱包的组员完成。部署者另设 DEPLOYER_PRIVATE_KEY、ORACLE_ADDRESS、ARBITER_ADDRESS。HSK 用于 gas，奖励为无实际价值的 MockUSDC。

## 操作顺序

1. Node 22.18+、pnpm 11，在 `hsk-core/` 运行 `pnpm install --frozen-lockfile`、`pnpm compile`、`pnpm test`。
2. 复制 `.env.example` 为 `.env.local`，组员部署并填写三个地址；私钥与 token 不上传、不发聊天。
3. 运行 `pnpm check`，再 `pnpm check --rpc` 核对链和合约。配置检查不打印秘密；检查通过不代表钱包余额或真实 GitHub 权限已验证。
4. 按 README 发一笔小额悬赏、接单。外部 AI 工具或人工完成 PR，合并并通过配置的检查。
5. 提交 PR 结果、确认结算、工作者提现；保存 job ID、PR URL、交易哈希、浏览器截图。

所有写操作默认预览，只有显式 `--send` 才签名发送。每个操作者从同一个项目目录运行，保留/交接 `.data/` 对应任务文件，绝不共享 `.env.local`。

## 验收界限

这是命令行演示，没有网页或内置自动编程代理。无需 Postgres、GitHub App 服务端或公网 webhook。GitHub 验收由 CLI 完成，合约本身不会读取 GitHub，发布者仍具有直接批准权限。结算产生可领取余额，需要单独提现。超时按原合约规则处理；CLI 暂不含争议处理命令。

最后未完成的一步是组员提供配置后的真实全流程交易验证，不能用单元测试代替。
