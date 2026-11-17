# Paper Reed 邮件核心实验补丁

这是可应用的源码修正实验，**不是已验收的客户端或可发布引擎**。来源为 Foundry376 的 Mailspring / Mailspring-Sync，保留上游版权与 GPLv3 许可；本仓库同样采用 GPLv3。

| 补丁 | 应用位置 | 固定基线 |
| --- | --- | --- |
| `0001-mail-core-guards.patch` | Mailspring 的 `mailsync/` 子模块 | `8681eae1d217d993e4d4dc7de17ae8b91fc3da49` |
| `0002-desktop-draft-boundaries.patch` | Mailspring 根目录 | `535f13dd463536f36728bce3efb4ae0d51ab3f19` |
| `0003-shared-mail-core.patch` | Mailspring 根目录，**在 0002 后应用** | 同上，加 0002 |
| `0004-desktop-mcp-csp.patch` | Mailspring 根目录，在 0003 后应用 | 同上，加 0002 / 0003 |
| `0005-unsaved-draft-close.patch` | Mailspring 根目录，在 0004 后应用 | 同上，加 0002 / 0003 / 0004 |
| `0006-conflict-recovery-copy.patch` | Mailspring 根目录，在 0005 后应用 | 同上，加 0002–0005 |
| `0007-connected-workspace.patch` | Mailspring 根目录，在 0006 后应用 | 同上，加 0002–0006 |
| `0008-recovery-provenance.patch` | `mailsync/` 子模块，在 0001 后应用 | 子模块固定基线，加 0001 |
| `0009-editor-recovery-identity.patch` | Mailspring 根目录，在 0007 后应用 | 桌面固定基线，加 0002–0007；需要 0008 引擎 |
| `0010-editor-controls.patch` | Mailspring 根目录，在 0009 后应用 | 桌面固定基线，加 0002–0007 / 0009 |
| `0011-signature-settings-emoji.patch` | Mailspring 根目录，在 0010 后应用 | 桌面固定基线，加 0002–0007 / 0009–0010 |
| `0012-settings-navigation-templates.patch` | Mailspring 根目录，在 0011 后应用 | 桌面固定基线，加 0002–0007 / 0009–0011 |
| `0013-settings-subpages.patch` | Mailspring 根目录，在 0012 后应用 | 桌面固定基线，加 0002–0007 / 0009–0012 |
| `0014-appearance-rules-folders.patch` | Mailspring 根目录，在 0013 后应用 | 桌面固定基线，加 0002–0007 / 0009–0013 |
| `0015-template-agent-settings.patch` | Mailspring 根目录，在 0014 后应用 | 桌面固定基线，加 0002–0007 / 0009–0014 |
| `0016-cli-agent-onboarding.patch` | Mailspring 根目录，在 0015 后应用 | 桌面固定基线，加 0002–0007 / 0009–0015 |
| `0017-inbox-operations-search.patch` | Mailspring 根目录，在 0016 后应用 | 桌面固定基线，加 0002–0007 / 0009–0016 |
| `0018-local-triage.patch` | Mailspring 根目录，在 0017 后应用 | 桌面固定基线，加 0002–0007 / 0009–0017 |
| `0019-local-rules-classification.patch` | Mailspring 根目录，在 0018 后应用 | 桌面固定基线，加 0002–0007 / 0009–0018 |
| `0020-attachments-cli-compose.patch` | Mailspring 根目录，在 0019 后应用 | 桌面固定基线，加 0002–0007 / 0009–0019 |
| `0021-quality-lifecycles.patch` | Mailspring 根目录，在 0020 后应用 | 桌面固定基线，加 0002–0007 / 0009–0020 |
| `0022-first-run-preview.patch` | Mailspring 根目录，在 0021 后应用 | 桌面固定基线，加 0002–0007 / 0009–0021 |
| `0023-independent-engine-path.patch` | mailsync 子模块根目录，在 0008 后应用 | 原生固定基线，加 0001 / 0008 |
| `0024-gmail-https-send.patch` | `mailsync/` 子模块，在 0023 后应用 | 原生补丁 0001 / 0008 / 0023 |
| `0025-google-desktop-authorization.patch` | Mailspring 根目录，在 0022 后应用 | 桌面固定基线及此前桌面补丁；需要 0024 引擎 |
| `0026-gmail-mailbox-actions.patch` | `mailsync/` 子模块，在 0024 后应用 | 原生固定基线及此前原生补丁 |
| `0027-multi-account-mailbox.patch` | Mailspring 根目录，在 0025 后应用 | 桌面固定基线及此前桌面补丁；需要 0026 引擎 |
| `0028-microsoft-send-boundary.patch` | `mailsync/` 子模块，在 0026 后应用 | 原生固定基线及此前原生补丁 |
| `0029-provider-onboarding.patch` | Mailspring 根目录，在 0027 后应用 | 桌面固定基线及此前桌面补丁；Microsoft 发信需要 0028 引擎 |
| `0030-multi-account-sender.patch` | Mailspring 根目录，在 0029 后应用 | 桌面固定基线及此前桌面补丁 |
| `0031-offline-workflow.patch` | Mailspring 根目录，在 0030 后应用 | 桌面固定基线及此前桌面补丁 |
| `0032-send-result-reconciliation.patch` | `mailsync/` 子模块，在 0028 后应用 | 原生固定基线及此前原生补丁 |
| `0033-local-mail-quality.patch` | Mailspring 根目录，在 0031 后应用 | 桌面固定基线及此前桌面补丁 |
| `0034-targeted-sent-copy-confirmation.patch` | `mailsync/` 子模块，在 0032 后应用 | 原生固定基线及此前原生补丁 |
| `0035-reviewed-send-revision.patch` | Mailspring 根目录，在 0033 后应用 | 桌面固定基线及此前桌面补丁 |
| `0036-gmail-shared-oauth.patch` | `mailsync/` 子模块，在 0034 后应用 | 原生固定基线及此前原生补丁 |
| `0037-google-login-reconnect.patch` | Mailspring 根目录，在 0035 后应用 | 桌面固定基线及此前桌面补丁；需要 0036 引擎 |

在干净的固定版本 checkout 中，使用补丁的绝对路径分别执行 `git apply --check <patch>`、`git apply <patch>`。0001、0008、0023、0024、0026、0028、0032、0034、0036 按顺序在子模块根目录应用；其余补丁按编号在桌面根目录应用。应用全部原生补丁后重新构建引擎，并替换实验桌面 `app/mailsync`；0010 不要求额外原生构建。本轮已在临时目录恢复各文件的基线版本、实际应用补丁，并逐字节比对测试过的源码。

当前工作区的 `research/.local/Mailspring` 已应用三十九份补丁，**不要重复应用**。安装过程中产生的上游 `app/package-lock.json` 变化不在补丁内。

接入方式：新增一个 `MailMutationGuard.hpp`，只依赖现有 SQLiteCpp / nlohmann。它由 `TaskProcessor.cpp` 和 `MailStore.cpp` 直接包含，不新增构建目标、服务、数据库或任务调度器。迁移在原数据库中建立 `PaperReedSend` 表和活动草稿唯一索引；实验阶段不改变上游 `user_version`。正式分支需要接入自己的版本化迁移。

说明、已执行检查与未完成事项见 [修复验证记录](../engine-fix-validation.md)。

0003 提供普通 GUI / MCP 共用草稿与发送操作服务，配套实验 CLI 和实际引擎检查见 [共享接口验证](../shared-core-validation.md)。

0004 修复桌面 CSP 下 MCP schema 校验失败，完整窗口交接证据见 [写信窗口验证](../compose-handoff-validation.md)。

0005 移除保存失败时仍关闭窗口的 700 毫秒兜底，保留未保存输入；复现与回归见 [未保存编辑冲突验证](../unsaved-conflict-validation.md)。

0006 提供写信窗口冲突时“另存副本并关闭”，沿用共享保存服务；重启恢复和失败保留检查见 [副本恢复验证](../recovery-copy-validation.md)。

0007 提供由 `core.paperReed.enabled: true` 开启的实验工作台：收件箱、会话／回复、写信、持续编辑状态和上下文交接。开关关闭时保留原有工作区；原有组件注册位置保留，正文继续使用上游隔离渲染器。启动前设置开关并重启，实验 harness 会自动配置独立目录。检查与限制见 [界面接入记录](../ui-validation-2026-11-16/README.md)。

0008 将恢复副本来源写入原数据库的 `PaperReedDraftRecovery` 表，与副本在同一事务保存；不修改邮件头。0009 收敛写信／回复结构，显示稳定副本编号、时间及来源跳转。恢复副本需要新引擎；旧引擎缺少表时明确拒绝保存副本，不能报告成功却丢失标记。已有未标记副本不回填猜测来源。详情见 [编辑器与副本验证](../editor-validation-2026-11-16/README.md)。

0010 打磨收件人补全、签名选择和格式工具，修正补全异步结果覆盖与取消时序，并补充格式工具键盘操作。界面仍由原有 Paper Reed 开关控制；补全时序和输入法保护、格式键盘操作适用于共用组件。实际窗口、选区和保存结果见 [控件验证](../controls-validation-2026-11-16/README.md)。

0011 在桌面 0010 后应用，调整签名管理页和表情选择器，不要求重编译引擎。见 [验证记录](../settings-validation-2026-11-16/README.md)。

0012 统一设置文字侧栏和返回入口，改进签名模板预览、键盘操作与 HTML 模式辨识，不要求重编译引擎。见 [验证记录](../navigation-validation-2026-11-16/README.md)。

0013 打磨通用、邮箱账号与快捷键子页，增加分组、账号颜色边框、快捷键搜索和键盘编辑入口，不要求重编译引擎。见 [验证记录](../subpages-validation-2026-11-16/README.md)。

0014 打磨外观、邮件规则与文件夹设置，明确固定样式及可用调整项，完善规则状态、排序和确认操作，并改进文件夹用途映射。见 [验证记录](../organization-validation-2026-11-16/README.md)。

0015 打磨邮件模板和 Agent 设置，补齐写信模板入口，改进权限、连接与令牌操作。见 [验证记录](../template-agent-validation-2026-11-16/README.md)。

0016 提供用户级 CLI 安装、连接诊断、读取命令和带操作指令的 Agent 交接，不要求重编译引擎。见 [验证记录](../cli-onboarding-validation-2026-11-16/README.md)。

0017 接通收件箱搜索、批量整理、逐项回执及精确撤销，并提供共用 CLI 命令，不要求重编译引擎。见 [验证记录](../inbox-validation-2026-11-16/README.md)。

0018 提供本机置顶、稍后、标签管理及共用 CLI，使用现有数据库中的本机表，不要求重编译引擎。见 [验证记录](../triage-validation-2026-11-16/README.md)。

0019 接通本机邮件规则、自动分类、手动纠正、已有邮件预览／应用及共用 CLI。在 Paper Reed 模式暂停原上游远端规则入口，不要求重编译引擎。见 [验证记录](../rules-validation-2026-11-16/README.md)。

0020 补齐 CLI 收件人编辑、回复建稿、附件读写、GUI 含附件恢复副本和发送附件快照；贯通设置与收件箱账号颜色，不要求重编译引擎。见 [验证记录](../attachments-validation-2026-11-16/README.md)。

0021 修复关闭期间新编辑丢失、附件错误消费与临时 pending 回收，合并列表读取、缩短后台整理占用写队列的范围，并增加启动时附件回收。不要求重编译引擎。见 [验证记录](../quality-fixes-validation-2026-11-16/README.md)。

固定基线准备、全部补丁重放、CLI 副本比对与 TypeScript 检查使用 [prepare-desktop.py](../../scripts/prepare-desktop.py)，命令见 [贡献指南](../../CONTRIBUTING.md)。

0022 接通空白配置的 IMAP / SMTP 首次接入、同步与重连提示，提供独立 Paper Reed 应用身份和开发启动入口。复用现有构建与凭据机制，不要求重编译引擎。见 [首用与打包验证](../first-run-validation-2026-11-16/README.md)。

0023 在 **mailsync 子模块根目录**、0008 之后应用，移除 Release 引擎对 Mailspring 路径的品牌限制。必须重新编译引擎并替换桌面／开发包中的 mailsync。见 [独立目录验证与真实试用准备](../real-trial-2026-11-16/README.md)。

0024 / 0025 增加自建 Google Desktop OAuth 授权及 Gmail HTTPS 发信，复用 IMAP 收信、加密凭据和发送结果；不增加服务端、不更改代理配置。真实验证、回归命令与边界见 [Gmail 接入验证](../gmail-integration-validation-2026-11-17/README.md)。

0026 / 0027 接通 Gmail 日常整理与逐封撤销，保留自定义标签，验证 Gmail 与普通 IMAP 混合账号的统一收件箱、草稿隔离与独立失败。复用原任务和同步进程。见 [混合账号验证](../gmail-mailbox-validation-2026-11-17/README.md)。

0028 在复用 Microsoft Graph 发送前关闭最终提交的自动重试，并区分明确拒绝与结果不明；复用原发送结果记录。见 [服务商代码研究与验证](../provider-integration-2026-11-17/README.md)。

0029 复用服务商选择、Microsoft OAuth、iCloud 预设与 IMAP 自动配置；三类均实现，不要求用户逐家提供测试邮箱。见 [接入与验证](../provider-integration-2026-11-17/README.md)。

0030 沿用现有默认发件账号设置，修正显式账号建稿时自动抄送／密送的归属，并在 CLI 草稿结果返回发件人。不新增设置模型或原生构建要求。见 [多账号发件身份验证](../multi-account-sender-validation-2026-11-17/README.md)。

0031 复用现有连接状态，补齐按账号的连接中断提示、离线说明及发送按钮／快捷键状态。恢复联网后不自动发送未提交的草稿。不要求重编译引擎，见 [离线读写与恢复验证](../offline-validation-2026-11-17/README.md)。

0032 / 0033 修复 Gmail 本机稍后／规则、SMTP 认证拒绝、迟到 Sent 副本确认及发送结果查询，删除过期保存延时和不可达 multisend 分支。0032 需要重编译引擎。见 [修复验证](../quality-fixes-2026-11-17/README.md)。

0034 / 0035 固定 GUI 审阅版本，停止发送间隙被改写的草稿；按当前 Sent 邮件确认关联记录，允许失败副本随后被确认，并保留 filed 的单向状态。清理桌面旧错误分支。0034 需要重编译引擎，见 [修复验证](../send-review-fixes-2026-11-17/README.md)。

0036 / 0037 将 Gmail 收信与 HTTPS 发信合为一次项目 OAuth 登录；复用既有 token 缓存、凭据加密和重连流程，旧 send-only 账号保持可用。0036 需要重新编译引擎。实现、验证与真实重授权边界见 [Gmail 统一登录](../gmail-oauth-validation-2026-11-17/README.md)。Microsoft 项目方注册步骤见 [填写清单](../provider-integration-2026-11-17/MICROSOFT-SETUP.md)。

0038 移除 Paper Reed 的 Microsoft 选择入口和专用登录页，保留上游协议实现及历史补丁。其他 IMAP 表单识别 Gmail 地址后引导 Google 登录，不再要求应用密码。不需要重编译原生引擎。验证见 [范围收敛记录](../provider-scope-validation-2026-11-17/README.md)。

0039 补齐项目 Google 配置打包、Paper Reed 预览版版本／源码归属与 Google 登录阶段提示。无原生改动。见 [发行配置验证](../distribution-validation-2026-11-17/README.md)。
