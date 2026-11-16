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

在干净的固定版本 checkout 中，使用补丁的绝对路径分别执行 `git apply --check <patch>`、`git apply <patch>`。0001、0008 按顺序在子模块根目录应用；0002–0007、0009–0017 按顺序在桌面根目录应用。应用 0008 后重新构建引擎，并替换实验桌面 `app/mailsync`；0010 不要求额外原生构建。本轮已在临时目录恢复各文件的基线版本、实际应用补丁，并逐字节比对测试过的源码。

当前工作区的 `research/.local/Mailspring` 已应用十七份补丁，**不要重复应用**。安装过程中产生的上游 `app/package-lock.json` 变化不在补丁内。

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
