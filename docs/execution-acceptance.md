# 执行、验收与结算（队友 B）

任务定义见 `docs/task-labels.md`。新版通用流程位于独立的 `hsk-common-v2/`，不修改现有 `hsk-core/` 或 Task Commons Demo。以下区分旧版真实链上案例与新版本地实现。

## 共用流程

```text
发布 TaskSpec 并封存 specHash → worker 提交 Artifact
→ 对应适配器生成 VerificationReceipt → worker 提交 resultHash
→ requester 重新验收同一 Artifact → 确认结算 → worker 提现
```

新版 `TaskSpec` 固定 HSK chain、合约、任务类型、输入身份、验收规则、标题、赏金和交付窗口。GitHub 输入为仓库与 Issue，规则包含检查 App ID、必需检查名和禁止修改的路径；CSV 输入为原文件 SHA-256、去重键和预期输出 SHA-256。链上只存 `specHash`，完整规格保存在 `hsk-common-v2/.data/jobs/<jobId>.json`，需要在执行者与验收者之间可靠共享。

两种适配器都返回 `VerificationReceipt`：`version`、`jobId`、`taskType`、`specHash`、`artifact`、`verified`、`evidence`、`resultHash`。失败时抛出错误，不生成通过的回执。回执是本地 JSON 数据，没有独立签名。`resultHash` 使用 `keccak256` 绑定任务编号、规格哈希、类型、GitHub `owner/repo#PR`（CSV 留空）和已验收的成果哈希。旧版任务沿用原有 PR 哈希，已发生的链上交易不受影响。

## GitHub 适配器

外部 coding worker 提交 PR。新版验收器要求 PR 已合并、标题或正文声明关闭该任务 Issue、没有修改 `tests/` 或 `.github/`，且指定 GitHub App 的必需检查在 PR head SHA 上全部成功。`submit` 保存 PR 编号与 SHA；`settle` 再查同一 PR 和 SHA，并核对链上及本地 `resultHash`。Issue 声明只能证明显式引用，无法单独证明代码确实解决了问题。

旧版 job 1 和 job 3 的 PR 付款、job 2 的退款已有真实测试网证据，见 `docs/e2e-evidence.md`。新版规则没有对应的真实链上交易证据。

## CSV 适配器

`acceptance/csv-dedupe` 按指定列保留首条。发布时封存原始输入 SHA-256 和预期输出 SHA-256；提交与结算时重新读文件并要求：

1. 表头与输入相同。
2. 输出 key 集合等于输入 key 集合。
3. 输出 key 无重复。
4. 标准化后的输出 SHA-256 等于预期值。

标准化采用 LF 换行及末尾一个换行。支持 UTF-8、逗号分隔、无引号字段的小型 CSV。独立 CLI 已接 `post --type csv-dedupe`、`submit --output` 和 `settle` 的本地代码路径及测试；还没有真实 CSV 测试网交易，也没有 CSV 网页付款入口。操作命令见 `hsk-common-v2/README.md`。

## 信任边界与剩余工作

链上合约不执行 GitHub 或 CSV 验收，它信任 requester 的 `approveJob`。独立 CLI 会在发送批准交易前重新验收，但 requester 仍可绕过 CLI 直接调用合约。原 Demo 的网页签名发送尚未完成联调，且不会自动使用本包。下一步由持测试钱包的联调队员在隔离环境跑新版 GitHub 与 CSV 真实任务，保存交易和余额证据；如需网页支持，应另行设计集成。完整争议操作尚未接入独立 CLI/UI。
