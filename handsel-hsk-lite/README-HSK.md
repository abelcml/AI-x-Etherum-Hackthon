# Handsel HSK Lite

黑客松最小改造版：复用 Handsel，接入 HSK 测试网；只演示一个 GitHub 仓库的修复悬赏。

**流程：Issue → 托管测试赏金 → AI worker 提交 diff → PR → 同一 head SHA 的 CI 成功 + 人工合并 → 合约结算。**

这是基于完整上游的少量适配，不是已经剥离所有模块的新框架。先保留原页面、数据库和合约，避免重写耽误演示。关闭不需要的外部服务配置即可；不要把 `/try` 当作链上结算演示。

## 快速启动

需要 Node 22.18+、pnpm 10、一个新的 Postgres 数据库。

```sh
pnpm install --frozen-lockfile
cp .env.hsk.example .env.local
# 在本地填写数据库、认证/加密密钥、GitHub App 和部署后的合约地址
pnpm dev
```

Windows PowerShell 用 `Copy-Item .env.hsk.example .env.local`。两个应用密钥各生成一个：`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`。

`HSK_GITHUB_REPOSITORY` 填实际演示仓库的 `owner/repo`，不要误填尚未安装 GitHub App 的仓库。GitHub App 权限及 webhook 配置沿用 [上游 GitHub 接入说明](docs/github-jobs.md)。公网 webhook 指向 `/api/github/webhook`，本地开发需要可访问的 HTTPS 地址。

HSK 结算还要求配置 `HSK_REQUIRED_CHECK_SUITE_APP_ID` 和 `HSK_REQUIRED_CHECK_NAMES`：前者填写可信 `check_suite` webhook 中的数字 `app.id`，后者填写该 App 必须通过的 Check Run 精确名称，逗号分隔。启用 GitHub App 的 **Checks: read** 权限。webhook 验签后，平台会查询该 PR head SHA 的最新 Check Runs；缺少配置、API 权限、必需检查、完整结果或 SHA 不匹配时都不会付款。HSK 演示只信任这一家 App 的这些显式检查名；其他 provider 或未列出的检查不会替代它们。准备演示时从真实 webhook 与仓库 Actions 检查名称填写配置，不要猜 App ID。

## 测试网部署

只用 HSK 测试网 133、HSK 测试 Gas、MockUSDC。先填写本地部署密钥、`ORACLE_ADDRESS` 和 `ARBITER_ADDRESS`，并准备测试 HSK。以下脚本会检查 RPC 的实际 chain ID。

```sh
node --env-file=.env.local scripts/deploy-mock-usdc.mjs
# 将输出的 USDC_ADDRESS 写进 .env.local
node --env-file=.env.local scripts/deploy-registry.mjs
# 将输出的 CREDIT_REGISTRY_ADDRESS 写进 .env.local
node --env-file=.env.local scripts/deploy-labor-v2.mjs
# 将输出的 LABOR_MARKET_ADDRESS 写进 .env.local
```

MockUSDC 是可自由 mint 的六位小数测试代币，没有真实价值。Agent owner/oracle 账户也需要测试 Gas；没有部署和资金就不能展示真实链上闭环。

## 演示的必需连接

- 在应用里创建用户和 agent，连接能够产出代码 diff 的 worker；沿用 [现有 worker 接入](docs/external-agents.md)，简单聊天模型不等于能修仓库的 agent。
- 在演示仓库安装 GitHub App，配置 CI，然后发布有明确验收标准的小 Issue。
- 配置定时结算：`vercel.json` 或 `.github/workflows/settle-heartbeat.yml`，后者需要 `PLATFORM_URL`、`CRON_SECRET`。超时不会凭空自动发生，需要后台触发交易。
- 暂不配置 ZeroDev、信用借贷、EAS 和 x402。不要通过 x402 入口支付 HSK 悬赏。

验收要覆盖：成功付款、CI 失败不付款、旧 SHA 不付款、无 CI 不付款、超时退款。链上付款和 GitHub/数据库仍是分布式流程，需要检查重试和交易回执，不能仅凭页面状态宣称成功。

## 来源和范围

上游：[Kairose-master/handsel](https://github.com/Kairose-master/handsel)，起点 `482c3106efe16ec5d229ef945d7d95ef972d2b76`。保留上游 LICENSE 和历史；本项目的 HSK 适配修改会单独提交。上游文档中的线上部署、审计或演示结果不代表此改造版已验证。

官方网络资料：https://docs.hskchain.net/docs/Build-on-HashKey-Chain/network-info
