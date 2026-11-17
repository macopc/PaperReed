# 多账号发件身份验证

2026-11-17。开始本轮前，三类服务商接入已提交并推送到 `main`：`91e3797`。

## 修正范围

[0030 桌面补丁](../patches/0030-multi-account-sender.patch) 修改四个现有文件，没有新增 provider 框架、依赖、数据库、锁或队列，也不要求重编译原生引擎。

- 工作台之前在全部邮箱视图中直接使用第一个账号，忽略已有的“新邮件默认发件账号”。现在单账号视图优先使用所选账号，全部邮箱视图使用有效默认账号，未设置或默认账号已移除时使用第一个可用账号。
- 上游 `DraftFactory.createDraft` 即使收到显式 `accountId`，仍从默认账号生成默认字段和自动抄送／密送；后续字段覆盖只改回账号和发件人，留下错误的自动收件人。现在直接从显式账号读取这些设置，回复也因此使用原邮件账号的配置。
- 设置页补充默认发件账号的适用范围，复用已有控件和配置键。
- 共用 `draftResult` 增加 `from` 字段，CLI／Agent 可以读取实际保存的发件身份。修改默认设置不改写已有草稿；本轮没有增加 Agent 切换草稿账号的能力。

## 验证方式

[19 项检查全部通过](result.json)，fixture SMTP 提交为零。

扩展既有 [混合账号 harness](../harness/check-multi-account-mailbox.cjs)，运行实际 Electron、CLI 和原生引擎，两个本机协议服务器分别模拟 Gmail 标签与普通 IMAP 文件夹。账号使用不同的自动密送地址，使跨账号配置错误可直接观察。

在原有整理、撤销、授权隔离和独立失败检查后，验证显式账号建稿、全部邮箱默认发件人、单账号优先、回复归属、修改默认账号并重启后的草稿身份，以及默认账号失效后的新邮件行为。新草稿经实际编辑器输入和保存，再由 CLI 读取核对。

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-multi-account-mailbox.py \
  --upstream research/.local/Mailspring \
  --output research/.local/multi-account-sender-results
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/prepare-desktop.py research/.local/sender-replay \
  --source research/.local/Mailspring --compare research/.local/Mailspring
python3 scripts/check.py
```

`sender-replay` 必须是新目录。测试使用独立配置、随机 MCP 端口和 loopback 网络限制，不修改用户邮箱、代理或真实应用配置，不发送邮件。

完整 TypeScript 检查通过；30 份补丁从固定基线重放通过，106 个源码文件与测试版本一致，CLI 副本一致。正式打包应用未重新构建。协议 fixture 不代表所有真实服务商已经认证通过；接入范围和 Microsoft 项目配置仍以 [服务商记录](../provider-integration-2026-11-17/README.md) 为准。

测试脚本等待账号导航完成、重启后的 CLI 就绪，并为启动时已存在的窗口注册对话框监听，避免 Playwright 重复处理 Electron 的退出对话框。这些修正仅在 harness 中，没有给产品新增重试或延迟。仓库静态检查通过（62 项 JavaScript 语法检查及已有 JSON／Markdown 链接检查），新增记录的链接和 JSON 另行检查。
