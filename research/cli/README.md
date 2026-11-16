# Paper Reed CLI · 实验版

CLI 随实验桌面源码补丁提供，复用桌面内的运行环境与固定版本 MCP SDK，不需要另装 Node 或全局 npm 包。当前不是独立发布的安装包；先运行已应用 [补丁系列](../patches/README.md)（包括 0018）的实验桌面。

## 从桌面接入

1. 打开 **设置 → Agent 连接**，开启本机 Agent 连接，并选择允许的操作和邮箱范围。建议先从只读开始。
2. 点击 **安装 CLI**。命令默认写入 `~/.local/bin/paper-reed`，连接文件写入当前桌面配置目录的 `paper-reed-cli/connection.json`。
3. 点击 **检查连接**，看到“连接正常”后，点击 **复制接入说明**，粘贴到能够执行本机命令的 Agent 会话。

写信、会话和列表页也可“复制给 Agent”，会携带当前邮件引用、读取命令和操作约束。CLI 调用始终使用设置中的实际权限；发送前应让 Agent 向用户确认。提示词中的确认要求不是额外的服务器审批机制，发送权限仍由当前 MCP 权限控制。

连接文件权限为 `0600`，所在专用目录为 `0700`。安装不会改写 shell 启动文件或 Claude Code、Codex、OpenCode 的配置。已有其他同名命令或符号链接时拒绝覆盖。安装和检查连接均不发送邮件。

本轮已在隔离 macOS Electron 实例中验证命令执行、读信、草稿交接和权限限制；尚未逐一完成第三方 Agent 客户端的交互验收。这里提供的是可粘贴给 Agent 的 CLI 任务，并非自动注册各客户端的 MCP 配置。

## 在终端使用

```sh
"$HOME/.local/bin/paper-reed" doctor
"$HOME/.local/bin/paper-reed" accounts
"$HOME/.local/bin/paper-reed" --help
```

如果 `~/.local/bin` 已在 PATH 中，可直接使用 `paper-reed`。也可复制设置页提供的完整路径命令；不依赖 PATH。希望在当前终端添加 PATH 时，可以手动执行：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

以下示例假设 PATH 已配置。JSON 通过 `--input` 或 stdin 传入，结果写入 stdout；失败退出码为 1。工具错误保留 JSON 结果；输入、连接和认证错误在 stderr 中提供 `error`、`code`、`hint`。CLI 只访问 `http://127.0.0.1:<port>/mcp`，不跟随重定向，不直接打开数据库。

```sh
paper-reed folders --input '{"accountId":"ACCOUNT_ID"}'
paper-reed search --input '{"accountId":"ACCOUNT_ID","query":"in:inbox","limit":25}'
paper-reed thread-get --input '{"threadId":"THREAD_ID"}'
paper-reed draft-get --input '{"accountId":"ACCOUNT_ID","draftId":"DRAFT_ID"}'

paper-reed draft-update <<'JSON'
{"accountId":"ACCOUNT_ID","draftId":"DRAFT_ID","expectedRevision":3,"changes":{"body":"修改后的正文"}}
JSON
```

| 命令 | 用途 |
| --- | --- |
| `doctor` | 检查本机连接、认证和可访问账号数；只读 |
| `accounts` | 列出已授权账号 |
| `folders` | 列出账号的文件夹；按 `role` 查找用途，不猜文件夹名称 |
| `threads` | 按账号和文件夹列出会话，支持分页 |
| `search` | 在显式账号范围搜索邮件，支持分页 |
| `thread-get` | 读取会话正文，仍受账号／文件夹权限限制 |
| `draft-get` / `draft-create` / `draft-update` | 读取、创建、更新共用草稿 |
| `draft-send` | 提交发送请求，需要发送权限及用户明确授权 |
| `operation-get` | 查询持久发送结果 |
| `mark-read` / `mark-unread` | 标为已读／未读 |
| `archive` / `spam` / `trash` / `restore-inbox` | 归档、垃圾邮件、废纸篓、移回收件箱 |
| `change-get` / `undo` | 查询整理任务／撤销一个可恢复的整理任务 |

每个邮件命令都提供 `paper-reed <command> --help` 和输入示例。`draft-create` 要求显式 `accountId` 和 `to` 数组。正文遵循草稿的 `plaintext` 格式，不能通过正文更新切换格式；当前编辑接口只修改主题和正文，其余字段保留。

`draft-send` 输入为 `{accountId,draftId,expectedRevision,requestId}`。重试间必须保持 `requestId` 不变。结果可能只是 `queued` 或 `pending-admission`，随后使用返回的 operation ID 查询 `operation-get`。结果未知、连接中断或超时时，不生成新请求 ID 重发；先检查操作状态或邮箱。详见 [共用接口记录](../shared-core-validation.md)。

## 整理邮件与查询结果

搜索仅覆盖本地已同步邮件，可使用 `from:`、`subject:`、`in:` 等现有查询语法；显式提供 `accountId`。GUI 搜索与普通 CLI 搜索复用同一查询入口。

```sh
paper-reed search --input '{"accountId":"ACCOUNT_ID","query":"subject:meeting","limit":25}'
paper-reed archive --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}],"requestId":"organize-001"}'
paper-reed change-get --input '{"accountId":"ACCOUNT_ID","taskId":"TASK_ID"}'
paper-reed undo --input '{"accountId":"ACCOUNT_ID","taskId":"TASK_ID"}'
```

整理命令最多接收 100 个明确的账号／会话引用，需要写权限。返回 `items` 数组，每项有 `accountId`、`threadId`、`status`，实际入队的项另有 `taskId`。`queued` / `syncing` 尚未完成；`succeeded` 为任务完成，`unchanged` 为无需改动，`rejected` / `failed` 带错误信息。批次只要存在拒绝或失败项，CLI 退出码为 1，但 stdout 保留全部结果，包括成功项。

使用 `change-get` 查询每个任务；返回 `undoable: true` 才可撤销，撤销也返回任务并需继续查询。不永久删除邮件；`trash` 是移入废纸篓。`restore-inbox` 恢复垃圾邮件／废纸篓中的邮件。当前精确文件夹适配不支持 Gmail 标签型 Inbox 的归档／移回，返回 `unsupported-mailbox-action`。

重试保持同一请求 ID、目标和动作；仍保留的同一任务不会重复提交，相同目标换动作会返回 `request-conflict`。每个任务只处理提交时已经存在的邮件，后来进入会话的邮件不自动包含在内。

**整理历史有界**：状态、重试识别和撤销依赖现有 Task 记录，历史清理后可能返回 `operation-not-found`；这不是失败证明，也没有跨清理周期的永久幂等保证。先检查邮件实际状态，不盲目生成新请求 ID 重试。`change-get` 查询整理任务，`operation-get` 查询持久发送结果，两者不可互换。详见 [整理与搜索验证](../inbox-validation-2026-11-16/README.md)。

## 置顶、稍后与本机标签

这些状态只属于当前设备的 Paper Reed，不修改服务商星标或创建服务商标签。GUI 与 CLI 使用相同本机状态。

```sh
paper-reed pin --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}]}'
paper-reed unpin --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}]}'
paper-reed snooze --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}],"until":"2027-01-01T09:00:00-05:00"}'
paper-reed unsnooze --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}]}'
paper-reed local-state --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}]}'
paper-reed local-list --input '{"accountId":"ACCOUNT_ID","view":"pinned","limit":25}'
paper-reed local-list --input '{"accountId":"ACCOUNT_ID","view":"snoozed","limit":25}'
paper-reed local-list --input '{"accountId":"ACCOUNT_ID","folder":"inbox","limit":25}'

paper-reed labels
paper-reed label-create --input '{"name":"项目跟进","color":"#688177"}'
paper-reed label-update --input '{"id":"LABEL_ID","name":"设计合作","color":"#957789"}'
paper-reed label-add --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}],"labelId":"LABEL_ID"}'
paper-reed local-list --input '{"accountId":"ACCOUNT_ID","view":"label:LABEL_ID","limit":25}'
paper-reed label-remove --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}],"labelId":"LABEL_ID"}'
paper-reed label-delete --input '{"id":"LABEL_ID"}'
```

`local-list` 返回会话摘要及 `local` 状态，支持 `limit`（1–100）、`offset`、`query`、`unread`。置顶与视图筛选在分页前执行。无搜索时，`folder: "inbox"` 隐藏稍后会话；普通 `search` 仍可找到它们。`local-state` 返回按会话 ID 索引的 `{pinned, snoozeUntil, labels}`；时间为 Unix 毫秒或 `null`。

本机批量命令最多接收 100 项，返回逐项 `succeeded` / `rejected`；有拒绝项退出码为 1，其余结果仍保留。这里没有 `taskId`，不调用远端整理的 `change-get` / `undo`。重复设置／添加／移除不会产生额外标签关联；重复稍后会重新建立来信基准。它不是发送账本式的请求去重。

`until` 必须是未来的 ISO 日期时间并带时区。稍后要求已同步且仍在收件箱的会话，到期或新外部回复解除；自己的回复、低 UID 历史补齐不会唤回。退出应用后没有后台计时进程，下次打开处理到期项。同步游标不可用时返回 `snooze-needs-synced-inbox`；垃圾邮件／废纸篓不能稍后，也不会被计时器移回。

标签词汇在本机所有账号间共用，颜色是六位十六进制值，名称为 1–40 字符且不允许同名。只读 Agent 可列出词汇（没有成员计数）。创建、修改或删除全局标签需全部已连接账号和文件夹的写权限；为授权会话添加／移除已有标签只需该会话的写权限。`label-delete` 删除标签及本机关联，保留邮件。

完整重启、IMAP 新回复、权限与当前边界见 [本机整理验证](../triage-validation-2026-11-16/README.md)。

## 连接恢复和移除

| 状况 | 下一步 |
| --- | --- |
| 找不到命令 | 用设置页复制的完整路径；或检查 PATH |
| `not-connected` | 在 Agent 设置中重新安装／更新 CLI 连接 |
| `authentication-failed` | 令牌可能已更换；点击“更新 CLI 连接”后再检查 |
| `connection-unavailable` | 保持桌面运行，开启 Agent 连接；若端口改变，更新 CLI 连接 |
| `Access denied` 或找不到对应草稿 | 检查允许的操作、账号和文件夹范围 |
| 连接正常但账号数为 0 | 接入邮箱，或调整 Agent 的邮箱授权范围 |
| 移动应用、切换实验 checkout、应用升级后命令失效 | 从当前应用重新安装 CLI，刷新运行路径 |

“命令位置与终端使用”下可移除 CLI，确认后仅删除本次安装的命令和连接文件，保留邮件与 MCP 设置。再次安装即可恢复。更改令牌或端口后，界面会提示连接待更新，不会静默改写连接文件。

连接文件含令牌，不提交到仓库、不粘贴给 Agent，也不要将令牌放入命令参数。复制的接入说明不含凭据。

## 从研究源码运行（维护者）

保留旧的开发环境变量方式，供隔离 harness 和源码维护使用：

```sh
export PAPER_REED_UPSTREAM="/absolute/path/to/patched/Mailspring"
export PAPER_REED_MCP_URL="http://127.0.0.1:2587/mcp"
export PAPER_REED_TOKEN_FILE="/absolute/path/to/private-token-file"
node research/cli/paper-reed.cjs doctor
```

token 文件只含桌面 MCP 令牌，使用 `0600` 权限。用户安装的 launcher 会忽略这三个旧变量，以本次安装的连接文件为准。`PAPER_REED_CLI_BIN_DIR` 可在启动实验桌面时覆盖安装目录，用于隔离测试；默认始终为用户的 `~/.local/bin`。

`paper-reed.cjs` 和 `install.cjs` 为 CLI 源文件，在 0016 中首次内置、0017–0018 中同步更新，以完全相同的内容放入桌面 `internal_packages/mcp-server/bin/`。更新时同步导出补丁并检查两份文件一致，不新增 npm 安装步骤。已验证范围与实际窗口见 [安装与接入验证](../cli-onboarding-validation-2026-11-16/README.md)。
