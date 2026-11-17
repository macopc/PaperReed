# 发送审阅边界与 Sent 副本修复

先提交并推送上一轮审查：`c565d5e`。本轮落实 [复审](../quality-review-followup-2026-11-17/README.md) 的 P1、两项 P2 及局部错误分支清理。源码变更仅涉及 4 个文件，补丁为 [0034](../patches/0034-targeted-sent-copy-confirmation.patch) 和 [0035](../patches/0035-reviewed-send-revision.patch)。

## 改动

- GUI 完成保存后固定账号和修订号，最终读取按账号限定并比较修订号。如果 Agent 在间隙保存新版本，清除发送中标记、提示重新审阅、保留编辑会话，不创建发送操作。最终读取后的变化仍由现有共用发送接口和原生 CAS 拒绝。没有锁住 Agent 或增加等待重试。
- 原生 `Message::afterSave` 确认 Sent 邮件后，直接把账号、Message-ID 和 Gmail id 交给现有发送记录更新；该热路径不再搜索 Message 表。发送接受／更新回执时，只针对这一条操作检查已到达的副本，保留“同步先到、发送接受后到”的顺序处理。
- 可靠副本证据可以把 pending 或 failed 变成 filed；`setCopy` 使用同一个条件更新保留已有 filed，迟到失败不能令状态倒退。没有增加表、字段、索引、后台扫描器或锁。
- 删除当前生产者已消失的 `send-partially-failed` / `smtp-auth-disabled` 桌面特殊分支；对当前 `send-rejected` 明确提示请求被拒绝、草稿仍可编辑，并保留具体原因。升级前持久任务若携带旧 key，仍有通用错误提示，不继续维护旧的服务商建议分支。

## 验证

| 检查 | 结果 |
| --- | --- |
| arm64 Release 引擎构建、完整 TypeScript 检查 | 通过；保留上游编译警告 |
| Electron GUI + CLI 修改审阅版本 | 在生产 GUI 最终读取处暂停，通过真实 CLI 保存新版；停止发送、保留编辑器、发送标记恢复、SMTP=0 |
| 离线 GUI／CLI 工作流 | 原有 6 项通过；恢复后显式发送 1 次，重启保持 accepted，无自动重投 |
| SMTP 本机协议 | 4 场景通过：认证拒绝、DATA 响应丢失、拒绝 multisend、Sent APPEND 响应丢失；最后一种重启同步后为 accepted/filed |
| Gmail HTTPS 本机协议 | 8 场景通过，含改写 Message-ID、迟到副本及重启不重投 |
| Microsoft Graph 本机协议 | 5 场景通过 |
| 生产 C++ guard | 原有事务／并发／SIGKILL 测试通过；新增失败副本后到、filed 不退回 failed/pending、先同步的改写 Gmail 副本、账号隔离通过 |
| 补丁重放 | 35 份补丁、107 个源码文件逐字节一致，CLI 副本一致 |
| 生产 SQL 合成成本 | 1 万封邮件、10 条待确认记录、100 次同步钩子查询，从约 0.9898 秒到约 0.0001 秒；新查询计划不访问 Message 表 |

性能数字来自内存 SQLite 的同结构合成测试，不是完整 GUI 的耗时承诺。新热路径仍读取当前账号的发送记录；本轮没有为尚未测得的发送历史规模增加索引或缓存。发送接受端只执行单操作查询，Gmail id 查询仍可能扫描账号消息一次；它不再随每次 Sent 保存重复执行。

[证据](evidence.json) 保存各测试结果、成本对比和引擎摘要。全部收发测试使用独立配置和 loopback 服务，未发送真实邮件或更改代理。开发 checkout 的 `app/mailsync` 已替换新引擎，分发应用尚未重新打包。

## 复现命令

```sh
python3 research/harness/check-native-guard.py --sync research/.local/Mailspring/mailsync
python3 research/harness/check-offline-workflow.py --upstream research/.local/Mailspring --output research/.local/quality-fix3-offline
python3 research/harness/check-smtp-send.py --upstream research/.local/Mailspring --binary research/.local/derived-data/Build/Products/Release/mailsync --output research/.local/quality-fix3-smtp
python3 research/harness/check-gmail-api.py --upstream research/.local/Mailspring --binary research/.local/derived-data/Build/Products/Release/mailsync --output research/.local/quality-fix3-gmail
python3 research/harness/check-microsoft-send.py --upstream research/.local/Mailspring --binary research/.local/derived-data/Build/Products/Release/mailsync --output research/.local/quality-fix3-microsoft
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/prepare-desktop.py research/.local/quality-fix3-replay --source research/.local/Mailspring --compare research/.local/Mailspring
python3 scripts/check.py
```

重放目标必须是不存在的新目录。成本探针在本机 `research/.local/quality-fix3-cost.py`，协议和 GUI 场景已合入现有 harness；未另建测试编排框架。原有 unknown 发送冻结和不猜测缺失 Graph 最终 Message-ID 的边界保持不变。
