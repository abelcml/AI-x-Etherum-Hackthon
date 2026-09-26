# HSK 悬赏精简版

从 [Handsel](https://github.com/Kairose-master/handsel/tree/482c3106efe16ec5d229ef945d7d95ef972d2b76) 提取三个原有合约，新增独立 Node 命令行适配 HSK 测试网（133）。保留上游许可证及合约 SPDX。

**当前验证：36 项本地测试通过，三个合约已部署到 HSK 测试网，并已跑通一次真实闭环（见 [docs/e2e-evidence.md](../docs/e2e-evidence.md)）。**

## 做什么

发布 GitHub Issue 悬赏 → 存入测试代币 → 工作者接单 → 外部 AI/人工完成 PR → PR 合并且指定检查通过 → 提交结果哈希 → 发布者确认结算 → 工作者提现。

只有一个运行依赖 viem；开发依赖 solc。无需数据库、GitHub App 服务端、网页或公网 webhook。AI 写代码由外部 coding worker 完成，本项目不包含自动编程代理。

GitHub 验收发生在 CLI 中，合约信任发布者的批准交易，并不自行访问 GitHub；发布者也可直接调用合约批准。测试币 MockUSDC 无实际价值，HSK 用于 gas。

## 已部署合约（HSK 测试网 133）

| 合约 | 地址 |
|---|---|
| MockUSDC | `0xf586ec82ee70d4bfdd7aba5e8ee01ebe002ffcdd` |
| AgentCreditRegistry | `0xf8528bc9d8d059a6de42c973a88ad02c82474aee` |
| LaborMarketV2 | `0xf7400c17e0b48ac3166efead6b349959b54a58a9` |

部署交易与参数见 [`contracts/README.md`](../contracts/README.md)。

## 安装与配置

使用 Node 22.18+ 和 pnpm 11。在本目录运行：

```sh
pnpm install --frozen-lockfile
pnpm compile
pnpm test
```

复制 `.env.example` 为 `.env.local`，填入组员提供的配置：

| 配置 | 用途 |
|---|---|
| USDC_ADDRESS / CREDIT_REGISTRY_ADDRESS / LABOR_MARKET_ADDRESS | 三个已部署合约地址 |
| REQUESTER_PRIVATE_KEY / WORKER_PRIVATE_KEY | 各自本地使用的测试钱包私钥，不提交仓库 |
| GITHUB_REPOSITORY | owner/repo |
| GITHUB_TOKEN | 有目标仓库 PR、检查结果读取权限的令牌 |
| GITHUB_CHECK_APP_ID | 可信检查来源的 GitHub App 数字 ID |
| GITHUB_REQUIRED_CHECKS | 必需 check-run 名称，英文逗号分隔 |

`pnpm check` 检查配置是否齐全；`pnpm check --rpc` 可额外核对链与合约。私钥只放各自本地文件，不发聊天、不上传。

## 演示步骤

所有写操作默认预览，确认后加 `--send` 才签名发送。以下展示实际发送命令，仅由有测试钱包的组员执行：

```sh
pnpm job post --issue 1 --title "修复示例错误" --bounty 1 --window 3600 --send
pnpm job accept --job 1 --send
# 外部完成 PR，合并并确保配置的检查通过
pnpm job submit --job 1 --pr 2 --send
pnpm job settle --job 1 --send
pnpm job withdraw --role worker --send
pnpm job status --job 1
```

job ID、PR 编号替换为实际值。所有命令从本目录执行，保留 `.data/` 中的任务记录；多人运行时需共享相应任务记录（其中不含私钥），不要共享 `.env.local`。结算先记入可领取余额，提现才到账。提交后的 PR SHA 必须与结算核验一致。

退出路径：`cancel`（未接单）、`reclaim`（交付超时）、`expire-open`（接单超时）、`expire-review`（审核超时）；均需满足合约状态和时间限制。审核超时遵循原合约规则，并非永久等待 GitHub 验收。

## 组员部署

部署者设置 DEPLOYER_PRIVATE_KEY、ORACLE_ADDRESS、ARBITER_ADDRESS。依次预览 `pnpm deploy token`、`pnpm deploy registry`、`pnpm deploy market`，确认后各加 `--send`，将输出地址填回配置。部署 market 前须已填 token/registry 地址。

`pnpm mint --to <测试钱包地址> --amount 10` 预览发测试币，确认后加 `--send`。本轮交付没有代替组员执行部署、发币或交易。

## 文件

- contracts/：原有三个合约。
- src/：链配置、任务记录、GitHub 验收、结果哈希。
- scripts/：编译、配置检查、部署和任务 CLI。
- tests/：本地单元测试与模拟 API 测试，不等于真实链上端到端测试。

精简范围：CLI 暂不提供 dispute/resolveDispute/expireDispute；恢复命令当前使用发布者钱包。原合约中这些能力仍保留。
