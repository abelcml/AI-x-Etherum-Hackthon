# Task Commons 真实接口适配

此入口适配现有 Cloudflare Task Commons 页面，与 `pnpm web` / 队友 PR #4 的 UI 独立。只新增适配层，不修改定价、合约、部署、结算 CLI 或 CSV 算法。原 Cloudflare 进程需要由它的运行者切换到本服务，上传代码本身不会更新旧地址。

## 启动

在 `hsk-core` 中安装已有锁定依赖并编译，然后运行：

```sh
pnpm install --frozen-lockfile
pnpm compile
pnpm web:commons
```

仓库中已登记的公共合约地址与 GitHub 检查配置在 `.env.commons.example`。首次运行且没有 `.env.local` 时，可复制该文件为 `.env.local`；已有配置请手动合并，勿覆盖钱包配置。默认发送关闭。公开仓库只读 GitHub 查询可不填 token，但受 API 限额影响。

真实 GitHub 验收的现成例子：本仓库 PR #7，提交 SHA `959d86d041b6859a07b17030447736d3bcb0b2ae`，检查 `hsk-checks`，App ID `15368`。这是验证接口的样例，不是赏金任务结算证据。不能据此宣称这个 PR 已收款。

打开 `http://127.0.0.1:4174`。没有 `.env.local` 也可执行真实 CSV 去重与文件验收。代码与链上功能按页面显示的缺项配置，不能用模拟状态替代。

## 已接入

- CSV：直接调用 `acceptance/csv-dedupe` 的参考执行器与验收器，按指定字段保留首条，保持 ID 集合、表头和顺序。前端固定预期哈希后允许粘贴外部交付并验收；输入变化会使旧验收失效。仅支持无引号字段的小型 CSV。未接 CSV 付款。
- GitHub：读取真实 PR 身份，调用 `verifyMergedPr` 并输出可下载的 JSON 回执和 `resultHash`。回执不是签名授权，不证明已经付款。指定 GitHub 检查提供方和检查名仍由团队配置。
- 任务：从同一目录的 `.data/jobs` 读取 CLI 已发布任务；查询状态会实际调用 CLI 读取合约。不会创建假任务。
- 交易：页面经白名单参数调用现有 `scripts/job.mjs` 的发布、接单、提交、结算、提现与退出命令。先实际预览，再使用一次性、两分钟有效的确认票据执行 `--send`。不会启动 shell 或自动重试付款。
- 翻译与争议：没有接入的操作明确禁用。没有内置 coding agent，PR 仍由外部执行器生成。

## 钱包与对外访问

此适配使用**已有 CLI 的服务器测试钱包**签名，不使用浏览器钱包，不把私钥发送给网页。团队登录拥有服务器配置的钱包操作权限，只给可信团队成员。

默认只允许读取、验收、预览。要实际发送，在服务器 `.env.local` 配置既有的 REQUESTER/WORKER 私钥及：

```dotenv
COMMONS_USERNAME=your-team-user
COMMONS_PASSWORD=your-own-strong-password
COMMONS_ENABLE_SIGNING=true
```

私钥、token、登录密码仅留在服务器本地，不提交。已有 `.env.example` 列出的合约地址、仓库与检查配置仍适用。浏览器每笔操作仍需预览后确认。

对外用 Cloudflare tunnel 转发本服务端口，并配置精确的公网来源：

```dotenv
COMMONS_PUBLIC_ORIGIN=https://your-current-tunnel.trycloudflare.com
```

公网访问必须同时配置上述团队账号密码，即使只读也一样。不要复用聊天里的示例密码。服务仅监听 127.0.0.1，没有开启跨站 CORS。旧站 `/procurement` 不属于本入口。

## 联调与交易不确定状态

1. 无钱包先验证 CSV 正确输出通过，删除一行后失败。
2. 配置真实 GitHub 信息，在网页输入 PR 编号与完整交付 SHA，验证成功和失败路径。
3. 部署三个合约后填写地址，`pnpm check --rpc`。用网页发布、接单，外部完成真实修复 PR，再提交、结算和单独提现。
4. 每步核对 CLI 返回的交易哈希、链上状态与钱包余额；验收通过不等于付款完成。

如果 CLI 报告回执未知或发送超时，本服务会写 `.data/commons-pending.json` 并阻止进一步发送。运行者须先核对其中的交易回执和任务状态，确认后才移除该标记。不要未经核对重复发送。

测试使用隔离的模拟 GitHub/API/CLI 与临时目录，不使用测试钱包。实际链上完整运行仍需组员配置后验证。Task Commons 复用现有验收与合约的信任边界，不新增“链上自动验证 GitHub”的声明。
