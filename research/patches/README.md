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

在干净的固定版本 checkout 中，使用补丁的绝对路径分别执行 `git apply --check <patch>`、`git apply <patch>`。0001 在子模块根目录应用；0002–0006 按顺序在桌面根目录应用。本轮已在临时目录恢复各文件的基线版本、实际应用补丁，并逐字节比对测试过的源码。

当前工作区的 `research/.local/Mailspring` 已应用六份补丁，**不要重复应用**。安装过程中产生的上游 `app/package-lock.json` 变化不在补丁内。

接入方式：新增一个 `MailMutationGuard.hpp`，只依赖现有 SQLiteCpp / nlohmann。它由 `TaskProcessor.cpp` 和 `MailStore.cpp` 直接包含，不新增构建目标、服务、数据库或任务调度器。迁移在原数据库中建立 `PaperReedSend` 表和活动草稿唯一索引；实验阶段不改变上游 `user_version`。正式分支需要接入自己的版本化迁移。

说明、已执行检查与未完成事项见 [修复验证记录](../engine-fix-validation.md)。

0003 提供普通 GUI / MCP 共用草稿与发送操作服务，配套实验 CLI 和实际引擎检查见 [共享接口验证](../shared-core-validation.md)。

0004 修复桌面 CSP 下 MCP schema 校验失败，完整窗口交接证据见 [写信窗口验证](../compose-handoff-validation.md)。

0005 移除保存失败时仍关闭窗口的 700 毫秒兜底，保留未保存输入；复现与回归见 [未保存编辑冲突验证](../unsaved-conflict-validation.md)。

0006 提供写信窗口冲突时“另存副本并关闭”，沿用共享保存服务；重启恢复和失败保留检查见 [副本恢复验证](../recovery-copy-validation.md)。
