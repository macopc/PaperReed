# Gmail 整理与混合账号验证

2026-11-17。本轮使用隔离的本机 Gmail 风格与普通 IMAP 协议服务器，运行实际 Electron 桌面、CLI、MCP 和自编译 mailsync；不是两个真实服务商验证，也没有操作真实邮箱或发送邮件。

## 改动

- Gmail 的归档／恢复 Inbox、Spam／Trash 和撤销共用既有 ChangeFolderTask。任务增加可选的 Inbox 目标状态，沿用原任务持久化、执行与结果查询，不另造标签任务链。
- 撤销保存每封邮件原有 Inbox 归属。同一会话里原本已归档的邮件不会因撤销而重新进 Inbox；当前自定义标签保留。移动到 Spam / Trash 后重新应用可写标签，不主动写入 Sent / Drafts 系统标签。
- 普通 IMAP 的“恢复收件箱”也支持从 Archive 恢复，仍使用原有文件夹移动。
- Gmail 的标签识别与 OAuth 判断分离，兼容通过普通 IMAP 接入的 Gmail；实际整理按同步得到的 Label / Folder 模型选择行为。
- 原生消息任务检查账号归属；历史操作读取／撤销使用当前 Agent 标签授权，避免权限收紧后绕过限制。

源码：[0026 原生补丁](../patches/0026-gmail-mailbox-actions.patch)、[0027 桌面补丁](../patches/0027-multi-account-mailbox.patch)。需要重编译原生引擎并放入桌面 `app/mailsync`。

## 可复现检查

先按 [贡献指南](../../CONTRIBUTING.md) 准备全部补丁、开发依赖和原生引擎，再运行：

```sh
npm --prefix research/.local/Mailspring run typecheck
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-multi-account-mailbox.py \
  --upstream research/.local/Mailspring \
  --output research/.local/multi-mailbox-results
```

测试不是只检查界面变化：每次远端完成后直接核对协议服务器的目录和标签。两个账号使用相同 Message-ID，以验证账号隔离；Gmail 会话包含一封 Inbox 邮件和一封已归档成员，以验证逐封撤销。还覆盖 GUI 跨账号批量操作、CLI 结果、重启后的撤销、独立草稿、排除账号／标签授权和单账号认证失效。

最终 13 项检查通过，见 [result.json](result.json)。SMTP 提交数为零。原生 Release 构建、完整 TypeScript 检查和仓库检查通过；27 个补丁从固定版本重放成功，101 个源码文件与测试版本逐字节一致，CLI 副本一致。新增多账号行为边界与后续真实接入顺序见 [多账号设计](../../design/MULTI-ACCOUNT.md)。

## 尚未证明

- 本轮未对真实 Gmail 执行归档、Spam / Trash 或撤销；Google 实际标签保留行为仍需真账号检查。fixture 故意在跨物理目录移动时清除标签，以检查客户端的保留逻辑，但不是 Google 服务的完整模拟。
- 真实第二服务商登录、发送、别名、默认发件账号和回复身份尚未完成联合验证。
- 沿用引擎现有失败处理；移动成功但标签写入失败会报告失败并重新扫描，不承诺跨 IMAP 命令的原子操作，不新增自动补偿层。
- 同步范围仍受服务商的 IMAP 可见目录限制；本轮不扩展远端搜索、共享邮箱或 Exchange 专属功能。

协议参考：[Google IMAP 标签扩展](https://developers.google.com/workspace/gmail/imap/imap-extensions)、[Google 系统标签说明](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels)。API 的系统标签限制不能替代 IMAP 真实验证，因此本轮只主动操作 Inbox 和保留可写标签。
