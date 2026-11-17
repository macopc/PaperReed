# 实施质量复审与下一步

审查基线：`46a5756`，包含 0001–0031 补丁。离线体验改动已先提交推送。采用 Good Offence 方法，沿调用链核对边界、错误归类、重复防御和并发时序。本轮只审查并记录证据，没有修改产品实现。

结论：现有本机架构可以继续使用，未发现需要新增服务端、provider 框架或锁管理器的理由。但目前还不能判定为可稳定日用：发现两项优先级 P1 的功能／恢复问题，两项 P2 的状态问题，以及可收敛的旧防御代码。服务商数量不应成为下一轮的主要目标，先修通已经承诺的行为。

## 1. P1：Gmail 的稍后处理与启用自动规则不可用

位置：`app/src/services/mail-core/local-triage.ts:211` 的 `inboxBaseline`，及 `saveLocalRule:486`、`listLocalRules:441`、`processLocalRules:658`。实现来源：[0018](../patches/0018-local-triage.patch)、[0019](../patches/0019-local-rules-classification.patch)、[0021](../patches/0021-quality-lifecycles.patch)。

`inboxBaseline` 固定从 `Folder` 查找 `role=inbox` 的 UID 游标。当前 Gmail 引擎中的 Inbox 是 `Label`，实际同步目录为 `Folder(role=all)`。不存在满足该查询的实体 Inbox，继续等待同步也不会让它出现。

**实际桌面／CLI／原生引擎复现**：同一混合账号 fixture 中，Gmail 的 `snooze` 和 `rule-save(enabled=true)` 都返回 `snooze-needs-synced-inbox`；普通 IMAP 的两项操作成功。数据库确认 Gmail 有 Inbox 标签和 All Mail 实体目录。既有测试分别验证过本机规则和 Gmail 整理，但缺少两者组合。

**最小修复**：让现有基线 helper 依据已有账号／目录语义选择 Inbox 或 All Mail，规则状态检查与扫描使用同一选择。Gmail 新邮件仍须按消息的 Inbox 标签判断，不能把 All Mail 中新出现的已发送邮件、归档邮件当成新收件。补 Gmail 稍后／新回复唤醒／规则的组合回归；不需要 provider 注册表，也不应添加等待重试。

## 2. P1：SMTP 明确认证拒绝被过度保守地标为 unknown，草稿无法恢复编辑

位置：`mailsync/MailSync/TaskProcessor.cpp:2447`、`:2695`、`:3018`；[0001](../patches/0001-mail-core-guards.patch) 建立的发送边界及其后续发送补丁。

在 SMTP 连接／认证前就记录 `attempting`；`_sendViaSMTP` 将认证错误包装为一般发送失败，外层将 attempting 阶段的异常统一改成 `unknown`。`MailMutationGuard::requireEditable` 会继续冻结这份草稿。

**已复现**：本机 SMTP 返回 `535 5.7.8 Authentication failed`，实际接受邮件数为 0；操作结果却是 `unknown`，随后保存同一草稿返回 `draft-frozen`。这不是响应丢失或部分投递，SMTP 尚未通过认证。早期 [实验记录](../engine-fix-validation.md) 已明确承认可能把明确网络拒绝归为不确定；本次证实它影响常见的密码失效恢复，不是新近才引入的问题。

**最小修复**：在既有 SMTP 适配边界保留足以区分“确认未提交”的错误类别，先覆盖明确认证拒绝；记录 `rejected` 并释放草稿编辑。保持 DATA 提交后的响应丢失为 unknown，不得把所有连接异常都改成可重试。无需增加自动重投、全局异常框架或新锁。

## 3. P2：晚到的已发送副本不会更新持久结果，pending 不收敛

位置：`mailsync/MailSync/TaskProcessor.cpp:2538`、`:2863`，以及 `app/src/services/mail-core/draft-files.ts:77`。相关发送实现：[0024](../patches/0024-gmail-https-send.patch)、[0028](../patches/0028-microsoft-send-boundary.patch)。

API 已接受但短暂查询未找到 Sent 副本时，记录 `accepted / pending`，之后由普通同步拉取邮件。普通同步没有把匹配副本关联回 `PaperReedSend` 的路径；重入 accepted 操作则直接返回旧记录。

**真实原生引擎 + 本机 Gmail API fixture 复现**：先成功提交一次，稍后让同一邮件（包含对应 X-GM-MSGID）出现在 Sent；同步数据库已出现非草稿邮件，重启后发送记录仍为 `pending`。API 提交次数仍为 1，未改走 SMTP。

影响：GUI／CLI 持续声称副本尚未归档；启动附件清理还会持续保留 accepted/pending 发送快照引用。这不是要求重新投递邮件，而是已经完成的同步状态没有收尾。

**最小修复**：在已有同步或结果核对路径中，按账号和可靠邮件标识关联 Sent 副本，更新现有记录为 filed。只核对副本，绝不再次提交发送；不要增加新的发信队列或凭主题猜匹配。

## 4. P2：发送结果轮询存在旧结果覆盖新结果的竞态

位置：`app/internal_packages/paper-reed/lib/workspace.tsx:292` 的 `refreshOperations`；[0021](../patches/0021-quality-lifecycles.patch) 后的当前实现。

每两秒轮询与发送成功事件都可能发起查询；完成时只判断 mounted，没有请求顺序保护。收件箱刷新已有 generation，整理回执也已有当前回执身份检查，此处没有沿用同等保证。

**生产组件方法的确定性时序实验**：先启动查询 A，再启动 B；B 返回 accepted 并更新界面后，让 A 返回 queued，界面退回 queued。该实验控制数据库 Promise 完成顺序，不把注入顺序当作实际生产耗时。

**最小修复**：使用该组件已有风格的请求序号／最后请求检查，成功和失败更新都只接受当前查询；不需要互斥锁或全局串行化。

另有同处查询问题：SQL 先对所有账号 `LIMIT 10`，再在 JavaScript 中按当前账号过滤。另一账号有十条较新发送记录时，本账号仍待确认的记录可能完全消失。应将账号条件放进 SQL 再限制条数。这一项由查询语义直接确认，未单独进行完整 GUI 复现。

## 5. P3：已被新契约覆盖的延时兜底与不可达分支

- `app/src/flux/stores/draft-store.ts:661` 在发送前找不到草稿时，仍用 150ms 延时再读一次。注释解释的是取消任务也被当作保存完成；现在 `saveDraft` 已拒绝取消／错误并要求修订回执，原生保存事务在任务离开 local 前提交。这条旧解释已不成立。建议保留一次读取和明确的草稿不存在处理，移除当前已验证保存路径上的延时与相应诊断分支；实际并发删除不能靠睡眠修复。
- `TaskProcessor.cpp:2694` 已统一拒绝 multisend；`:2724` 又重复拒绝，后面的 SMTP 定制正文投递和 Sent 多副本清理分支因此不可达。`_sendViaSMTP` 在该文件仅一个调用方。建议先把不支持的输入在进入构造／网络工作前拒绝，再删当前路径不可达分支。保留原线协议参数兼容不代表必须保留不可达运行逻辑；无需顺便重构整个上游发送器。

以上为调用链分析建议，不伪称已经做了删除后的完整回归。

## 应保留的保护、既有债与审查范围

应保留原生事务中的修订检查、发送去重／冻结未知结果、附件独立快照、异步等待后的授权复核，以及短暂的提交去重。GUI 禁用按钮和核心拒绝离线发送分别覆盖交互／CLI 两个入口，不应为减少检查次数而删掉其中之一。队列尾部吞掉 rejection 以允许下一项运行、同时向原调用者返回失败，也不是“吞错”。

未发现需增加锁的证据。现有本机写队列仍有可收敛空间：`applyLocalRules` 将最多 100 项的异步读取放在同一 serial 区间，better-sqlite3 在 renderer 的 10 秒 busy timeout 也仍存在；这是此前已记录、未完全消除的性能风险，未在本轮测得真实卡顿，不与上面已复现的问题混为一谈。

工程上，31 份补丁仍可从固定基线重放，CI 已包含重放与 TypeScript 检查，较上轮有改进；CI 尚未运行原生协议／Electron 端到端检查。源码覆盖多个文件的功能需要组合验证，单一服务商／单个模块分别通过无法覆盖 Gmail 规则这类交叉缺口。暂不为此搬迁全仓或搭建通用测试编排平台，优先把本次复现转成少量回归。

审查覆盖共用草稿／发送、附件生命周期、整理与本机规则、工作台异步更新、最新接入流程，以及直接相关原生状态机；不是对上游整个 Electron／Mailcore／C++ 依赖树的全面审计。此次没有重新发送用户邮件、修改真实邮箱或代理配置。

## 建议推进顺序

1. 修 Gmail 本机稍后／规则语义，以及 SMTP 明确拒绝后的草稿恢复。
2. 修 Sent 副本状态收尾、发送结果查询竞态及账号过滤；顺手清理上面的局部旧防御代码。
3. 收口 Google／Microsoft 项目身份与正常用户授权流程；见 [邮箱覆盖表](../../design/MAIL-PROVIDERS.md)。不要求用户为每家邮箱准备测试账号。
4. 将已完成能力重新打包成可试用版本，再根据真实兼容性反馈扩支持范围。POP3、JMAP 专用路径和 Exchange 专用协议暂不抢占前三项。

## 证据

[evidence.json](evidence.json) 保存四个复现及被测引擎 SHA-256。Gmail 稍后／规则与 SMTP 认证失败均无真实投递；晚到副本实验只向本机 API fixture 提交一次。状态错序实验运行生产 TypeScript 组件方法，用可控数据库 Promise 复现。

本机探针保留在 `research/.local/quality-audit-2026-11-17/`：`probe-gmail.py/.cjs`、`probe-smtp-auth.py`、`probe-late-sent.py`、`probe-refresh.cjs`。前三者复用已提交的混合账号、Microsoft／Gmail fixture harness，使用 loopback sandbox；它们是本次审查探针，尚未作为修复回归收录。修复时应把必要场景合入现有 harness，避免永久维护多份复制脚本。
