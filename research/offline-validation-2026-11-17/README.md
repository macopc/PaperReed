# 离线读写与恢复联网验证

2026-11-17。开始本轮前，多账号发件身份修正已提交并推送到 `main`：`86158ef`。

## 范围与实现

邮件核心已经拒绝离线发送，但界面没有订阅同步进程的连接状态，发送按钮也没有随系统离线状态更新。[0031 补丁](../patches/0031-offline-workflow.patch) 仅修改工作台和发送按钮两个既有组件：

- 工作台订阅已有 `OnlineStatusStore`，显示受影响账号的连接中断；切换到健康账号时不显示另一个账号的错误。普通连接中断提供原有的“重试同步”，不要求重新登录。
- 系统报告离线时，工作台说明缓存邮件仍可阅读、草稿可保存，联网后需再次点击发送。
- 发送按钮跟随 `online`／`offline` 事件更新，并阻止键盘发送入口；卸载时移除监听。CLI 继续使用既有核心离线检查，没有增加校验层、网络探测、重试或第二套队列。
- 收信连接失败不等于系统完全离线，也不证明 HTTPS 发信不可达。因此不使用“任一账号 IMAP 断开”来禁用所有账号发信。网络恢复提醒与引擎重连继续使用已有机制。

不修改公司代理、路由器或用户实际邮箱配置，不改变发送结果状态机。

## 验证

[6 项端到端检查通过](result.json)。使用实际 Electron、生产 CLI、原生引擎与两个本机 IMAP／SMTP 服务器：

1. 真正停止其中一个 IMAP 服务并断开现有连接，引擎报告连接中断，界面按账号显示；另一个账号仍能保存草稿。
2. 停止两个 IMAP 服务，通过 Playwright 为 Electron 页面模拟系统离线状态。GUI 仍显示缓存收件箱，CLI 能查询缓存收件箱及正文。
3. CLI 离线建稿，GUI 编辑并保存；按钮和快捷键不能提交发送，具有发送权限的 CLI 返回 `offline`，持久发送表为空。
4. 正常退出并以离线状态重启，GUI／CLI 都能读到保存后的草稿，没有发送提交。
5. 恢复原端口上的 IMAP 服务与页面在线状态，原生同步读到新邮件，发送按钮恢复；没有自动发送草稿。
6. 用户动作由测试脚本点击 GUI 发送后，服务器恰好收到一封正确正文，发送记录为 `accepted` 且 Sent 副本为 `filed`；再次重启保持一份发送记录和一次投递。

整个测试始终保留本机 SMTP 服务可用，以便观察产品是否错误提交；最终仅账号 0 的 fixture 收到一封，账号 1 为零。没有真实邮件发出。操作系统网络与公司代理未改变：系统离线信号是页面模拟，原生 IMAP 连接中断则来自实际关闭测试端口。此结果不等同于所有网络／代理场景或真实服务商都已验证。

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-offline-workflow.py \
  --upstream research/.local/Mailspring \
  --output research/.local/offline-results
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/prepare-desktop.py research/.local/offline-final-replay \
  --source research/.local/Mailspring --compare research/.local/Mailspring
python3 scripts/check.py
```

重放目标必须是新目录。开发源码已更新；正式打包应用未重建。本轮不扩展断网整理、睡眠唤醒、磁盘故障、未缓存附件下载或发信中途断连；发送结果不明仍沿用已有行为，后续按实际缺口验证。

完整 TypeScript 检查通过；31 份补丁从固定基线重放通过，106 个源码文件与验证版本一致，CLI 副本一致。仓库静态检查通过（62 项已有 JavaScript 语法检查及 JSON／Markdown 链接检查），新增 harness 的 JavaScript／Python 语法、新增验证记录链接与结果 JSON 已另行检查。
