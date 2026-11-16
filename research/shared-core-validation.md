# CLI / GUI 共用草稿与发送结果接口

2026-11-16。前一轮源码修复与原生协议验证已提交推送为 `f90ceca`。本轮接续 [自编译引擎验证](patched-engine-validation.md)，实现了第一版共享服务和实验 CLI，仍保留为小范围上游补丁，不迁移产品页面。

## 本轮交付

- [0003-shared-mail-core.patch](patches/0003-shared-mail-core.patch)：在 Mailspring 桌面源码内增加 `src/services/mail-core/index.ts`。普通 GUI 新建／保存草稿、账号迁移时的新草稿保存、默认发送动作，以及 MCP 草稿工具接入同一服务。
- [实验 CLI](cli/paper-reed.cjs)：读取 JSON 请求，通过现有 bearer 认证的本机 MCP 通道调用工具；不连接邮箱、不读取或修改 SQLite，不启动第二个同步引擎。
- 持久数据仍在原 SQLite / `PaperReedSend`，写入仍由原生任务处理器完成。没有新增数据库、队列或公网后台。

补丁 0003 应用于固定 Mailspring `535f13dd` **已经应用 0002** 的 checkout；对应的引擎必须应用 0001 并重新编译。当前隔离工作区已应用全部补丁。已从原文件恢复、依次应用 0002 / 0003 并比对，结果与测试源码一致。

## 小范围接口约定

`draftId` 暂时映射现有 `headerMessageId`，始终与 `accountId` 一起传入。`revision` 使用原模型版本。

| CLI 命令 / MCP 工具 | 必要输入 | 返回 |
| --- | --- | --- |
| `draft-get` / `get_draft` | `accountId`, `draftId` | 正文、主题、To/Cc/Bcc、正文格式与 `revision`；正文未缓存时报错 |
| `draft-create` / `create_draft` | `accountId`, `to`, `subject`, `body` | 本机保存后的 `draftId`, `revision`，不发送 |
| `draft-update` / `update_draft` | 账号、草稿、`expectedRevision`, `changes` | 成功保存的修订；首个更新面只允许正文与主题，保留其他邮件字段 |
| `draft-send` / `send_draft` | 账号、草稿、`expectedRevision`, `requestId` | `operationId` 与阶段，不返回虚假的 `sent: true` |
| `operation-get` / `get_operation` | `accountId`, `operationId` | 投递阶段与 `sentCopy`；不返回冻结正文或凭据 |

`requestId` 由调用者生成并保留。服务将账号与请求标识确定性映射到原 Task ID。**同一账号、同一请求、同一草稿修订，先读取持久发送记录并返回原操作**，即使原草稿或 Task 历史已经删除也不再次入队；同请求改用另一草稿或修订则返回 `request-conflict`。新的请求标识仍受引擎的草稿发送占用约束，不能绕过去重。

发送受理最多等待 5 秒；未拿到回执返回 `pending-admission` 和确定的操作 ID，不能解释为已受理或已投递。稍后用原请求重试或查询操作；若尚无持久记录，查询会返回 `operation-not-found`。网络投递不由此等待控制，也不自动重发。

发送阶段使用 `queued`、`running`、`accepted`、`unknown`、`failed`，取消记录可返回 `cancelled`；副本结果单独为 `pending`、`filed`、`failed`。`accepted` 只表示发件服务器接受，不表示收件人已收到。老任务没有持久发送记录而且只有 `complete` 时按不确定处理，避免误报成功。

接口在入口及异步读取后检查账号／能力，MCP 沿用现有账号与文件夹可见性规则。GUI 使用本机桌面身份；Agent 发送仍需 MCP 的发送授权。这不构成“撤销授权后原生队列尚未执行的任务自动取消”的完整实现，该执行前检查仍待完成。

## 实际验证

使用本轮共用 TS 服务的原源码，加载一个窄测试适配器替代 Electron 的 Model / TaskQueue / 数据库连接。适配器通过 stdin/stdout 与 Python fixture 通信，Python 驱动**实际自编译 mailsync**，数据库查询仅使用只读连接。所有写入走引擎任务；SMTP 仅本机模拟服务，外网由 sandbox 禁止。

以下检查通过：

1. 创建本机草稿，读取实际保存修订；通过桌面身份修改中文换行正文，另一调用方读到相同内容。
2. 基于旧修订保存被拒绝，新内容保留；错误账号读取被拒绝。
3. 未授权发送被拒绝，SMTP 接收数仍为 0。
4. 同请求重试返回同一个 operation；相同请求改修订被拒绝，换请求尝试发送同一草稿也被拒绝。
5. 服务端接受后 SMTP 数量为 1；用额外 110 个真实失败任务触发上游历史清理，重启后确认原 Task 已不存在，原请求仍返回原操作且没有重投。
6. 实际启动独立 CLI 子进程，经 SDK、本机 bearer 认证 MCP 测试端点、共用服务，查到同一个实际引擎发送操作，状态为 `accepted`。

验证命令，在 Paper Reed 根目录：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-shared-core.py \
  --upstream research/.local/Mailspring \
  --binary research/.local/derived-data/Build/Products/Release/mailsync
```

最近一次产物目录为 `research/.local/shared-core-opweog_f`。引擎指纹仍为 `0209cb33ad90b19b7f5a7dd1a2d63bb128a103bab5d27b4e328cbbd1f4901b4c`，本轮无需修改原生补丁。

此外：完整上游 `npm run typecheck` 通过；既有草稿界面边界测试通过；将新引擎放入隔离桌面 checkout 后，使用全新配置的 Electron 启动检查通过，未发现新增模块导致启动失败。启动检查沿用外层 loopback 沙箱、禁用嵌套 Chromium 沙箱的实验设置，不是正式分发验证。

**测试边界：** CLI 测试使用测试 MCP 端点和真实共用服务，不是运行中的桌面 MCP 注册器；“GUI 身份修改”调用实际共用服务，但没有在真实写信窗口键入内容。桌面目前只验到欢迎页。因此没有宣称完整的“CLI 创建 → 窗口修改发送 → CLI 查询”交互验收完成。测试没有使用真实邮箱或 OAuth。

## 接下来只补必要闭环

- 在真实桌面测试账号中完成上述窗口交接，确认更新通知与错误提示；特殊发送扩展仍保留上游路径，首版应禁用或逐个接入，不能称所有插件都经过新服务。
- 处理权限撤销后的待执行任务、冲突时关闭窗口、附件不可变快照，以及 `unknown` 的人工核对入口。
- 继续使用既有设计，不先扩展 CLI 搜索、批量整理、规则或 Agent 启动器。本 CLI 尚未安装到 PATH，没有一键配置真实 Agent，也没有独立发行包。
