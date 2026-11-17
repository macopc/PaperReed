# 邮件核心质量修复验证

审查记录已先提交推送：`e8c0c8c`。本轮针对 [质量复审](../quality-review-2026-11-17/README.md) 的四项功能／状态问题及两处旧代码做局部修复，新增补丁 [0032](../patches/0032-send-result-reconciliation.patch)、[0033](../patches/0033-local-mail-quality.patch)。未增加服务端、provider 框架、任务队列、重投机制或锁。

## 修复

- **Gmail 稍后与自动规则**：根据同步得到的 Inbox 类型选择实体 Inbox 或 All Mail 游标，复用整理邮件模块的 `CategoryStore + Label` 判定，不依赖登录方式或服务商名称。按每封邮件的 Inbox 标签判断新收件，同会话的新归档／Sent 邮件不触发规则或唤醒。
- **SMTP 认证拒绝**：在现有 SMTP 边界将明确认证失败归为 `rejected`，允许继续编辑草稿；DATA 已提交但响应丢失仍为 `unknown`，不会自动重投。
- **迟到 Sent 副本**：在 `PaperReedSend` 增加 `sentIdentity` 列，与 accepted 状态在同一 SQL 更新中记录。Gmail 保存 API id 对应的十进制 X-GM-MSGID；普通 SMTP 保存 Message-ID，Graph 在取得最终 Message-ID 后更新标识。现有消息保存钩子只在确认 Sent 邮件时核对账号、标识和目录，更新为 filed；接受结果时也查询一次，覆盖同步已先到达的顺序。核对不发送邮件。最终 pending 结果不会覆盖同步已经写入的 filed。
- **发送结果列表**：局部请求序号丢弃过期成功／失败，切换账号时拒绝旧账号结果。账号条件进入 SQL，再取最近 10 条。
- **删减旧逻辑**：移除已被保存回执契约取代的 150ms 读后延时；保留一次读取及草稿不存在错误。将不支持的 per-recipient bodies 提前拒绝，删掉后续不可达 SMTP 多次发送、重复 Graph 拒绝及对应多副本清理分支。正常 SMTP 副本去重不变。

## 已执行检查

| 检查 | 结果 |
| --- | --- |
| Release arm64 原生构建、完整 TypeScript 检查 | 通过；编译仍有上游第三方头文件警告 |
| Gmail HTTPS 协议回归 | 8 场景通过，含 Message-ID 被改写、迟到 Sent 副本、重启不重投 |
| SMTP 边界回归 | 3 场景通过：535 拒绝后可编辑、DATA 响应丢失仍冻结、multisend 零投递拒绝 |
| Microsoft Graph 协议回归 | 5 场景通过，含明确拒绝和不确定结果 |
| Electron + CLI + 原生引擎混合账号 | 22 项通过，含 Gmail 新收件触发、归档／Sent 同会话不误触发、普通 IMAP 回归 |
| 离线 GUI／CLI 草稿与发送 | 6 项通过，恢复后显式发送一次、重启仍 accepted；覆盖删除 150ms 延时后的 GUI 保存发送链路 |
| 生产工作台方法时序检查 | 旧成功、旧失败、切换账号均不覆盖当前状态；实际 SQLite 验证先按账号筛选再 LIMIT |
| 固定基线补丁重放 | 33 份补丁、107 个源码文件逐字节比对；CLI 副本一致 |

结果见 [evidence.json](evidence.json)。测试全部使用独立配置目录与本机 loopback 服务；未发送真实邮件、修改真实邮箱或代理。补丁需要重新构建原生引擎，本轮已经替换开发 checkout 的 `app/mailsync`；尚未重新打包分发应用。

## 复现命令

```sh
python3 research/harness/check-gmail-api.py --upstream research/.local/Mailspring --binary research/.local/derived-data/Build/Products/Release/mailsync --output research/.local/quality-fix2-gmail
python3 research/harness/check-smtp-send.py --upstream research/.local/Mailspring --binary research/.local/derived-data/Build/Products/Release/mailsync --output research/.local/quality-fix2-smtp
python3 research/harness/check-microsoft-send.py --upstream research/.local/Mailspring --binary research/.local/derived-data/Build/Products/Release/mailsync --output research/.local/quality-fix2-microsoft
python3 research/harness/check-multi-account-mailbox.py --upstream research/.local/Mailspring --output research/.local/quality-fix2-mixed
python3 research/harness/check-offline-workflow.py --upstream research/.local/Mailspring --output research/.local/quality-fix2-offline
node research/harness/check-send-status.cjs research/.local/Mailspring
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/prepare-desktop.py research/.local/quality-fix2-final-replay --source research/.local/Mailspring --compare research/.local/Mailspring
python3 scripts/check.py
```

Electron 场景顺序执行，避免两个测试同时操作桌面。重放目标必须是不存在的新目录。`check-send-status.cjs` 中的 delayed database error 是受控旧查询故障，用于验证过期错误不会清空较新的结果。

## 保留的边界

没有把所有 SMTP 网络异常都改成 rejected，也没有重投 unknown；只有明确认证拒绝能证明 DATA 尚未提交。没有通过主题、收件人或时间猜测 Sent 关联。Graph 若未取得最终 Message-ID 且服务商改写了原始头，仍需保持 pending，不能凭空确认；这不影响已接受邮件的投递结果。升级前未保存 Gmail API 关联标识的历史记录也不猜测补齐。

此前记录的 renderer SQLite 阻塞风险、本机规则批量串行读取和 CI 尚未覆盖原生／Electron 集成仍未在本轮扩大重构。下一步可回到 Google／Microsoft 普通用户授权流程及打包试用。
