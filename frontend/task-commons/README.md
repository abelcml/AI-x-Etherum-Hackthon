# Task Commons · 团队前端对齐稿

本目录是独立静态前端，无 npm 安装、数据库、模型密钥或钱包要求。面向 `docs/task-labels.md`、`docs/execution-acceptance.md` 和 `hsk-core/README.md`；不修改队友核心实现。

## 本地打开

使用 Node 22.18+，在仓库根目录运行：

```powershell
node frontend/task-commons/serve.mjs
```

打开 http://127.0.0.1:8780 。也可用任意静态服务器托管此目录；资源使用相对路径。请使用 localhost 或 HTTPS，CSV 哈希依赖 Web Crypto。

```powershell
node --test frontend/task-commons/csv-adapter.test.mjs
```

## 真实与模拟

- 代码修复：预设问题、补丁和 CI 资料，仅用于展示。没有真实 GitHub Issue、PR 或执行 Agent。
- CSV：使用团队 sample.csv，浏览器真实按 id 去重保留首条，检查表头、id 集合、重复项及固定标准输出 SHA-256。不带引号的 UTF-8 CSV；8 行输入、5 行输出。可注入删行、缺失输出、旧版内容，实际检查会失败。
- 套餐：代码 S 2 tUSDC / 30 分钟；CSV S 0.5 tUSDC / 10 分钟。M 套餐仅作文字参考。全部为 MockUSDC 测试报价，不代表市场定价。
- 资金：托管、批准结算、可领取、单独提现均为浏览器模拟，无交易。手续费与 worker 押金尚未读取，不能当作实际总成本。
- 争议仅为待接入标记；退款是情形注入，不代表合约已到期。
- 浏览器 localStorage 保存每个场景；不同队友的操作不会同步。重置只清当前场景。

## 大家怎么改

- `index.html`：页面结构和文字。
- `task-board.css`：布局和外观。
- `task-board.js`：任务样例、演示状态和交互。
- `csv-adapter.js`：真实 CSV 计算及验收（按团队文档独立实现的浏览器适配器）。

编辑后刷新本地预览即可。提交到同一功能分支或提 PR 合并。**GitHub 保存代码，Cloudflare Tunnel 转发运行中的网站，两者不自动同步。** 当前 Alex 的旧公网链接仍从其电脑提供网页；需要 Alex 同步仓库前端文件，网址才更新。

纯前端可另行部署到静态托管，但本 PR 不开通新托管、不修改仓库 Pages 设置、不上传任何账号密码。电脑上的旧采购页不属于这个独立前端。

## 之后怎么接 hsk-core

当前没有 HTTP 后端，也不在浏览器执行私钥或 shell 命令。服务端适配需要返回任务编号、状态、PR / head SHA、必需检查与来源、结果哈希、可领取余额、真实交易哈希。界面付款应映射 requester settle，提现映射 worker withdraw。

现有 `hashJobSpec` 只封存核心字段，不应把前端导出的完整验收说明直接声称为当前合约已绑定的字段。代码任务与 PR 的关联、禁止修改路径等仍按核心实现进度标明边界。CSV 尚未接链上结算。本页导出 JSON 是讨论资料，不是已经约定的后端 API。
