# Paper Reed CLI

CLI 随 [Paper Reed 桌面测试版](https://github.com/macopc/PaperReed/releases/tag/v0.0.2) 提供，与桌面共用邮箱和草稿。打开桌面端即可从设置安装 CLI，无需另装 Node 或全局 npm 包。源码构建对应 [补丁系列](../patches/README.md)。

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
| `attachment-get` | 读取附件元数据、可用本机路径；小型文本附带正文 |
| `draft-get` / `draft-create` / `draft-update` | 读取、创建、更新共用草稿 |
| `draft-reply` | 为指定会话创建回复或回复全部草稿，不发送 |
| `draft-attach` / `draft-detach` | 按草稿修订添加／移除附件 |
| `draft-send` | 提交发送请求，需要发送权限及用户明确授权 |
| `operation-get` | 查询持久发送结果 |
| `mark-read` / `mark-unread` | 标为已读／未读 |
| `archive` / `spam` / `trash` / `restore-inbox` | 归档、垃圾邮件、废纸篓、移回收件箱 |
| `change-get` / `undo` | 查询整理任务／撤销一个可恢复的整理任务 |

`draft-create` 和 `draft-reply` 成功时，回执中的 `status: "saved"` 表示草稿及正文已经保存。需要核对时，用返回的 `accountId` 和 `draftId` 调用 `draft-get`。

每个邮件命令都提供 `paper-reed <command> --help` 和输入示例。`draft-create` 要求显式 `accountId` 和 `to` 数组。正文遵循草稿的 `plaintext` 格式，不能通过正文更新切换格式；编辑接口可修改主题、正文与 `to` / `cc` / `bcc`，其余字段保留。收件人字段省略表示不修改，传 `[]` 表示清空；发送前必须至少有一个有效收件人。

`draft-send` 输入为 `{accountId,draftId,expectedRevision,requestId}`。重试间必须保持 `requestId` 不变。结果可能只是 `queued` 或 `pending-admission`，随后使用返回的 operation ID 查询 `operation-get`。如果首个回执丢失，手里只有 requestId，则用首次提交的完整参数（包括原 expectedRevision 和 requestId）重试 `draft-send`。若已受理，会返回同一发送操作的结果；若首次请求未到达，则按原授权提交。详见 [共用接口记录](../shared-core-validation.md)。

## 回复与附件

```sh
paper-reed draft-reply --input '{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID","type":"reply-all","body":"<div>谢谢，附件已补充。</div>"}'
paper-reed draft-attach --input '{"accountId":"ACCOUNT_ID","draftId":"DRAFT_ID","expectedRevision":1,"path":"/absolute/path/report.pdf"}'
paper-reed draft-get --input '{"accountId":"ACCOUNT_ID","draftId":"DRAFT_ID"}'
paper-reed attachment-get --input '{"messageId":"MESSAGE_ID","fileId":"FILE_ID"}'
paper-reed draft-detach --input '{"accountId":"ACCOUNT_ID","draftId":"DRAFT_ID","expectedRevision":2,"fileId":"FILE_ID"}'
```

示例中的修订号仅为示意：**每次使用上一次成功结果或重新 `draft-get` 得到的 `revision`**。`draft-reply` 的 `type` 为 `reply`（默认）或 `reply-all`，保留回复关联和引用；创建草稿不等于发送。回复内容按该草稿的正文格式处理。

`draft-get` 现在包含 `messageId` 和 `files`（ID、名称、字节数、类型、内嵌图片 contentId）。`attachment-get` 使用这两个对象的实际 ID，不猜磁盘位置。普通收信同样先从 `thread-get` 的消息 `files` 获取 ID。小于等于 200 KiB 的文本附件返回 `data`，其他附件使用结果中的本机 `path`；CLI 不把图片或 PDF 二进制塞进 JSON，也不会自动复制到下载目录。

`draft-attach` 要求本机文件的绝对路径，只接收普通文件；复制完成后再保存草稿，之后修改原文件不会改变附件。每封草稿附件总量最多 **25,000,000 字节**（沿用桌面限制，包含内嵌图片；服务商的 MIME 编码后限制可能更低）。`draft-detach` 只改草稿引用，为未保存的 GUI 编辑保留缓存文件；内嵌图片仍被正文 `cid:` 引用时拒绝移除，需要先修改正文。

附件和收件人修改都经过共同修订检查与账号／文件夹权限检查。发生冲突时读取最新草稿再决定如何合并；超时也不能直接换修订盲目重试。发送会为当前附件建立独立文件快照，缺失或无法完整复制时阻止提交。GUI 的含附件恢复副本同样使用独立文件，不再共用可被其他编辑移除的附件。

真实 Electron、CLI 与本机 IMAP / SMTP 的检查见 [附件与写信闭环记录](../attachments-validation-2026-11-16/README.md)。

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

## 邮件规则与分类

规则只操作本机标签与分类。先保存为暂停状态，确认字段后再将同一 ID 的完整规则保存为 `enabled: true`。修改、启用或排序不会回填历史结果；已有邮件需要单独预览和应用。

```sh
paper-reed rules --input '{"accountId":"ACCOUNT_ID"}'
paper-reed rule-save --input '{"accountId":"ACCOUNT_ID","name":"项目通知","field":"subject","query":"项目","action":"category","value":"notifications","enabled":false}'
paper-reed rule-save --input '{"accountId":"ACCOUNT_ID","id":"RULE_ID","name":"项目通知","field":"subject","query":"项目","action":"category","value":"notifications","enabled":true}'
paper-reed rules-reorder --input '{"accountId":"ACCOUNT_ID","ids":["RULE_ID_2","RULE_ID_1"]}'
paper-reed rule-delete --input '{"accountId":"ACCOUNT_ID","id":"RULE_ID"}'

paper-reed rules-preview --input '{"accountId":"ACCOUNT_ID","targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}]}'
paper-reed rules-apply --input '{"accountId":"ACCOUNT_ID","revision":"PREVIEW_REVISION","targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID","messageId":"PREVIEW_MESSAGE_ID"}]}'

paper-reed classify --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}],"category":"people"}'
paper-reed classify-auto --input '{"targets":[{"accountId":"ACCOUNT_ID","threadId":"THREAD_ID"}]}'
paper-reed local-list --input '{"accountId":"ACCOUNT_ID","view":"category:notifications","limit":25}'
```

- `field` 为 `sender` 或 `subject`，按名称／邮箱或主题做不区分大小写的子串匹配，`query` 最长 200 字符。`action` 为 `label`（`value` 使用已有标签 ID）或 `category`（`ordinary`、`people`、`notifications`、`subscriptions`）。
- `rule-save` 是完整规则保存，提供 ID 为编辑，省略 ID 为创建；`enabled` 默认 `false`。`rules-reorder` 必须提供该账号全部规则 ID，各出现一次。
- 标签累加，最后一个匹配分类生效。手动 `classify` 设置持久人工优先标记，后续规则不覆盖它；`classify-auto` 用最新外部来信重新计算当前分类并清除人工优先标记。
- `rules-preview` 只读，返回规则 `revision` 与每项的 `messageId`、命中规则、拟添加标签、分类及人工优先状态。`rules-apply` 使用这些原值，仅提交用户明确选择的目标（最多 100 个）；规则已变或最新来信不同会拒绝，需重新预览，不能自行替换引用绕过检查。
- 创建／修改／删除／排序规则要求该账号全部文件夹的写权限；应用到已有会话则逐项检查范围。保存的启用规则会持续作为本机自动化工作，之后关闭 Agent 连接不等于暂停规则。
- `local-state` 现在同时返回 `category` 和 `categoryManual`。规则变化或删除不会回滚旧状态；删除标签会暂停引用它的规则。

规则自动处理使用持久的逐消息已处理标记；这与远端整理 `change-get`、发送 `operation-get` 不同，不产生这两类任务 ID。窗口关闭后没有后台执行服务，打开应用后继续。执行范围、预览限制与完整验证见 [规则验证记录](../rules-validation-2026-11-16/README.md)。

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

`paper-reed.cjs` 和 `install.cjs` 为 CLI 源文件，在 0016 中首次内置、0017–0019 中同步更新，以完全相同的内容放入桌面 `internal_packages/mcp-server/bin/`。更新时同步导出补丁并检查两份文件一致，不新增 npm 安装步骤。已验证范围与实际窗口见 [安装与接入验证](../cli-onboarding-validation-2026-11-16/README.md)。
