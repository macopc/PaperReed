# 质量复审：发送审阅边界与副本核对

审查基线：`9dbc8f4`，已先提交并推送 main。包括 0001–0033 补丁。参考 Good Offence，沿当前调用链区分必要的外部边界、异步复核与不再有依据的防御。本轮没有修改产品代码。

后续：以下发现已由 0034 / 0035 修复，见 [修复验证](../send-review-fixes-2026-11-17/README.md)。下文保留修复前的审查事实。

现有架构可继续使用；不需要新增锁、服务、provider 框架或重试层。上一轮修复有明确改善，但仍有一个应优先修复的发送审阅竞态，以及两项副本确认问题。之前的回归通过不能代替这些组合场景。

## P1：GUI 发送会接受审阅之后被 Agent 改写的草稿版本

位置：`app/src/flux/stores/draft-store.ts:644–660`、`send-actions-store.ts:24–28`、`services/mail-core/index.ts` 的 `submitSend`。

点击发送后，GUI 提交自己的编辑、销毁编辑会话，然后按 Message-ID 重新读取当前数据库草稿；没有把刚刚审阅／提交的修订号与重新读取的版本比较。默认发送动作把重读对象的版本传给 `submitSend`，原生 CAS 因此检查的是新版本，不能保护先前审阅的内容。

可发生的顺序是：GUI 保存第 4 版 → Agent 保存第 5 版 → GUI 重读第 5 版 → 以第 5 版修订号提交。发送 admission 尚未发生，Agent 的保存是被允许的。这是本项目强调的 GUI／Agent 共用草稿场景，不需要假设数据库损坏或不可能的输入。

**证据**：抽取生产 `_onSendDraft` 方法、使用 TypeScript 转译后运行，在 teardown 与最终读取之间插入外部保存；审阅正文 `Reviewed GUI text` / v4，交给真实方法的发送动作出口的是 `New text saved by external agent` / v5。该实验控制 I/O 时序，未运行完整 GUI，也未发送真实邮件；后续默认发送动作和共用接口的版本传递由调用链确认。

**最小修复建议**：固定刚刚审阅并保存的账号、Message-ID、修订号；向已有 `submitSend` 传递这一修订号，变化时用现有冲突流程要求重新审阅。若保留最终读取，必须比较原修订号，不能悄悄采用最新值。无需锁住 Agent，也不要靠延时等待“稳定”。

## P2：SMTP 副本标为 failed 后，即使同步成功也无法收敛

位置：`mailsync/MailSync/TaskProcessor.cpp:2791–2793`、`MailMutationGuard.hpp:144–166`；[0032 补丁](../patches/0032-send-result-reconciliation.patch)。

SMTP 已接受邮件后，客户端可能执行 IMAP APPEND 保存 Sent 副本。如果服务器保存成功但 APPEND 的响应在网络中丢失，当前逻辑写入 `accepted / failed`。新核对 SQL 只接受 `sentCopy='pending'`，因此后续真实同步到同账号、同 Message-ID 的 Sent 邮件也不会更新 failed。另一方面，`setCopy` 无条件覆盖既有副本状态，后台先写入 filed 时也存在被迟到失败回写的窗口。

**原生引擎协议复现**：本机 SMTP 接受 1 封；IMAP 存入 Sent 后断开 APPEND 响应；重启普通同步后，服务器与本地数据库都已有副本，发送记录仍为 `accepted / failed`。未重投。测试使用当前 Release 引擎和独立 loopback fixture。

**最小修复建议**：把“已经观察到副本”设为不可退回的事实；同步证据可将 pending 或 failed 更新为 filed，迟到的失败不能覆盖 filed。沿用现有表和条件 UPDATE，不增加重试、锁或新状态机。

## P2：每次保存一封 Sent 邮件，都核对整个账号的待确认记录与消息集

位置：`mailsync/MailSync/Models/Message.cpp:560–567`、`MailMutationGuard.hpp:144–159`；[0032 补丁](../patches/0032-send-result-reconciliation.patch)。

消息保存钩子已知道当前消息，却只传 accountId。核对 SQL 为该账号每条 accepted/pending 记录搜索 Message；CASE 包装标识条件后，实际查询计划使用 `MessageListDateIndex(accountId)` 扫描账号消息，未使用已有 headerMessageId 索引。只要有尚未找到的副本，后续不相关 Sent 邮件的保存也重复这项工作，包括同步或已读状态变化。

**量化证据**：从真实 fixture 数据库复制表结构与索引，使用生产 SQL，在内存库中放入 10,000 封邮件，重复 100 次钩子查询。0 / 1 / 10 条待确认记录分别约 0.0004 / 0.0992 / 0.9898 秒。这是合成 SQL 成本测试，不能当作完整客户端卡顿时长；查询计划和随待确认记录数增长的工作量已确认。

**最小修复建议**：同步钩子直接用当前消息的账号和稳定标识更新关联记录；发送接受端只核对该次操作，覆盖同步先到达的顺序。不先加缓存、后台扫描器或新连接池。需要索引时围绕最终的窄查询决定，而不是维持全量扫描再补性能框架。

## P3：原生清理后，桌面仍保留两个失去生产者的错误分支

`app/src/flux/tasks/send-draft-task.ts:200–235` 仍解释 `send-partially-failed` 和 `smtp-auth-disabled`。在当前原生／桌面源码中搜索这两个 key，只有该处理处；上一轮删除多次 SMTP 提交和特殊认证包装后，新发送不会产生它们。这个问题不需要新抽象：整理客户端错误映射，明确现有 `send-rejected` 的提示；若确需展示升级前持久任务的旧错误，注明该兼容用途后再决定保留范围。不是优先于前三项的修复。

## 应保留与暂不扩大处理的内容

- 原生草稿 CAS、发送 admission 去重和 unknown 冻结有跨进程依据，不能当成“过度校验”删除。
- 文件复制前后大小检查面对异步文件 I/O；授权检查跨越异步读取／复制，权限可以变化，重复外观不等于冗余。
- 本机写队列让本地规则和标签写入有明确顺序；目前没有引入新锁的必要。先缩小受控范围，不能直接删掉现有串行化。
- 已有的规则批量串行读取、renderer 的 10 秒 SQLite busy timeout、原生／Electron 测试尚未进入 CI，仍属已知债。本轮没有重新证明实际卡顿，不把它们包装成新发现。
- 不建议为了减少补丁数量马上搬迁仓库；现有 33 份补丁有可重放验证。也没有依据为了单个实现新增 provider 注册表、通用异常层或自建任务系统。

## 范围与证据

本轮检查最新副本核对、发送状态及 Gmail 本机规则修改，并追踪共用草稿／发送、编辑会话、附件清理、任务排队和工作台异步结果的直接调用者；不是整个上游依赖树的审计。此前通过的构建与组合回归见 [修复验证](../quality-fixes-2026-11-17/README.md)，本轮新增三项针对性实验见 [evidence.json](evidence.json)。

探针保留在本机 `research/.local/quality-review2-2026-11-17/`：`probe-send-race.cjs`、`probe-smtp-copy.py`、`probe-reconcile-cost.py`。前者运行生产方法，第二个复用已有 SMTP harness 并丢弃 Sent APPEND 回执，第三个复用真实 schema 执行生产 SQL。后续修复时合并必要回归到现有 harness，不永久维护多个复制测试。

建议先固定 GUI 审阅版本，再把副本核对改为按消息处理并保持 filed 单向确认；最后顺手清理旧错误提示。无需扩大架构。
