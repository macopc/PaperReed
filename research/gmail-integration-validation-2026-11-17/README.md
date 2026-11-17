# Gmail 授权与 HTTPS 接入验证

日期：2026-11-17。此记录区分真实 Gmail 结果与本地协议测试；不包含 OAuth 客户端配置、令牌、应用密码或真实收件箱截图。

## 实现范围

- IMAP 收信继续使用应用专用密码；Gmail 发信显式选择 HTTPS API，不尝试 SMTP 兜底，不改代理、DNS 或路由。
- 桌面接入页选择项目自己的 Google OAuth Desktop JSON，系统浏览器授权，随机 loopback 端口、state 与 PKCE；只请求 `openid email gmail.send`。之前在 Google 控制台登记的 `gmail.modify` 和 `mail.google.com` 本轮未请求。
- 授权后核对邮箱身份、发信权限及 refresh token；原生连接测试再次刷新令牌并核对身份，不发送测试邮件。
- Gmail refresh token 和 Desktop client secret 通过现有 KeyManager / Electron safeStorage 加密。账号配置只保留开关及 client ID；日志脱敏补入新字段。CLI 不接触 Google 凭据。
- 原生引擎每次发送前刷新 access token，复用既有草稿快照、MIME（含 To/Cc/Bcc）与持久发送记录。没有新增服务端、发送队列或通用代理层。
- HTTPS 提交只执行一次：明确的 HTTP 4xx 为 rejected；响应丢失、5xx 或缺少消息回执为 unknown；有效回执为 accepted。unknown 不自动重发，也不切回 SMTP。
- Gmail 自行保存 Sent 副本，客户端不额外 APPEND。通过 API 返回的十六进制邮件 ID，对应 IMAP `X-GM-MSGID`，定位 Sent / All Mail 中的副本。

源码分别在 [0024 原生补丁](../patches/0024-gmail-https-send.patch) 和 [0025 桌面补丁](../patches/0025-google-desktop-authorization.patch)。0024 需要重新编译引擎；0025 需要重新构建桌面包。

## 真实 Gmail 已验证

使用用户提供的专用测试账号与自建 OAuth Desktop 客户端，在原公司网络下进行：

1. 系统浏览器授权、PKCE 交换、发信 scope 和邮箱身份核对通过。
2. 原生 IMAP TLS 连接和 Google refresh-token 刷新通过。
3. GUI 启用 Agent read-draft 权限并安装 CLI；当前 Codex 通过 CLI 读取邮件、建稿、修改草稿，GUI 独立写信窗口显示修改后的正文。
4. 用户明确批准后，仅从 GUI 发送 **一封** 自发自收邮件，无附件；Google 返回成功，发送记录为 accepted。
5. 用只读 IMAP 分别核对 Inbox 与 Sent：各一份，Gmail 邮件 ID 相同；CLI 也读取到同一封邮件及修改后的正文。
6. 退出并重新打开原配置，不需要重新授权；CLI doctor 成功，账号与邮件恢复。账号明文配置中不存在新增秘密字段，现有加密凭据存在。

真实测试揭示 Gmail 改写了 MIME Message-ID。第一封测试邮件发送时，代码仍按原 Message-ID 查副本，因此该**历史操作**保持 `accepted / pending`，但实际投递及 Sent 副本已独立确认。随后已改用 Gmail 稳定 ID，并通过改写 Message-ID 的本地端到端回归；**没有为修正后的版本再发送第二封真实邮件，也没有手工把旧记录改成 filed**。

## 回归验证

授权模块测试使用实际 TypeScript 模块与本机 HTTP 回调，覆盖成功、取消文件选择、取消授权、错误 state、账号不匹配、缺少发信权限和 token endpoint 拒绝：

```sh
node research/harness/check-google-authorization.cjs research/.local/Mailspring
```

原生测试使用编译后的 mailsync、隔离的 IMAP 服务器和 Google HTTP fixture，不访问外网。覆盖成功但副本尚不可见、Message-ID 被改写后的正确副本关联、明确拒绝、响应丢失、无有效回执、5xx、refresh token 拒绝；检查重启及相同操作重入不重复发送、SMTP 提交始终为零。

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-gmail-api.py \
  --upstream research/.local/Mailspring \
  --binary research/.local/derived-data/Build/Products/Release/mailsync \
  --output research/.local/gmail-api-validation
```

测试 harness 为上游 Gmail fixture 补充了 `UID SEARCH X-GM-MSGID` 的协议行为（包括标签视图独立 UID）；这部分只用于测试，不修改邮件客户端行为。

## 当前边界

- 此接入仍是开发预览：需要选择自建 Desktop client JSON，不是发布版的一键 Google 登录。
- Google OAuth 测试模式的授权有效期受 Google 限制；本轮未做多日有效期验证。
- 日历 RSVP 的 Gmail HTTPS 发送尚未实现，明确拒绝，避免退回当前网络不可用的 SMTP。
- Gmail 标签整理沿用此前实现，本轮没有扩展自动归档／标签映射。
- 如果 Sent 副本在当前有限等待内不可见，发送保持 accepted，副本状态保持 pending；本轮未新增后台补偿队列。
- 本轮第一遍普通首用 UI 回归遇到 Playwright 对已关闭对话框的处理错误；不据此修改生产逻辑，单独重跑其原有连接／重启／发送流程后通过，fixture SMTP 恰好提交一次。

## 参考

- [Google Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
- [Gmail IMAP 稳定邮件 ID](https://developers.google.com/workspace/gmail/imap/imap-extensions)

最终结果：[真实接入](real-result.json)、[7 项原生回归](native-results.json)、[普通首用完整回归](first-run-result.json)。TypeScript 检查、原生 Release 构建、仓库检查及 25 个补丁重放通过；99 个源码文件与测试版本一致，CLI 副本一致。
