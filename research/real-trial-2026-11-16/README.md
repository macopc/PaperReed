# 真实邮箱试用准备与独立目录修复

> 后续进展（2026-11-17）：已通过自建 Google OAuth + Gmail HTTPS 发信完成真实接入、Agent 草稿交接与自发自收验证，见 [Gmail 接入验证](../gmail-integration-validation-2026-11-17/README.md)。下文保留首次 SMTP 受阻时的诊断记录，不代表当前接入状态。

范围：一个真实 IMAP / SMTP 服务商、一个专用测试账号、一个 Agent，完成读信、修改草稿、回 GUI 审阅的路径。用户已选择 Gmail 专用测试账号与当前 Codex。已验证 Gmail IMAP TLS 登录和只读打开收件箱；SMTP 网络连接阻塞，尚未完成 GUI 账号接入或真实 Agent 草稿任务。

## 准备时发现的问题

上游 Release 引擎要求可执行文件路径包含 `mailspring`。此前打包测试位于 `research/.local/Mailspring/...`，隐含满足该条件；复制原引擎到 `research/.local/paper-reed-trial/mailsync` 后，`--mode migrate` 无输出并返回 2。

[0023 补丁](../patches/0023-independent-engine-path.patch) 删除这项品牌路径判断，异常堆栈仍使用真实 `argv[0]`。没有引入新路径白名单、重试或安装目录约束，也没有改变认证、TLS 或邮件写入逻辑。

重新编译 Release 原生引擎后，同一路径迁移返回 0。将新引擎替换进现有开发预览包，再把整个应用复制到 `research/.local/paper-reed-trial/Paper Reed.app`，在该位置运行首次启动回归。[结果](result.json) 为隔离本机服务测试，**不是真实服务商验收**。独立目录下接入、密码失效重连、重启恢复草稿、GUI 发送／归档和 CLI 读取均通过；本机 SMTP 恰好收到一次提交。全部 23 份补丁重放后，91 个修改文件与测试源码逐字节一致。该本机应用仍未经过 Developer ID 签名／公证。

## 复现

按 [原生构建说明](../patched-engine-validation.md) 在应用 0023 后重新编译，再替换开发包 `Contents/Resources/app.asar.unpacked/mailsync`。源码运行用的 `app/mailsync` 也需更新。将开发包移到路径不含 `mailspring` 的目录，然后执行：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-first-run.py \
  --upstream research/.local/Mailspring \
  --app 'research/.local/paper-reed-trial/Paper Reed.app/Contents/MacOS/Paper Reed' \
  --output research/real-trial-2026-11-16
```

测试新增 `--output` 仅用于分开保存验证记录，避免覆盖上轮证据。没有新增测试框架。

## 真实试用的执行顺序

1. 确认服务商、专用测试账号和服务器设置，凭据通过专用输入卡提供，不进入仓库。先验证服务商正常 TLS 连接，不开启“允许不安全 SSL”。
2. 用约定的测试邮件检查中文正文、HTML、附件和回复关系；核对收件箱／草稿／已发送／归档的实际文件夹映射。
3. 首个 Agent 暂按当前 Codex 准备：GUI 开启“阅读与草稿”，范围限定测试账号；安装 CLI，复制当前会话的交接说明。Agent 使用实际 accountId／threadId，先读草稿 revision，再修改同一草稿。
4. 回 GUI 检查正文、收件人和附件；发送由用户在 GUI 确认。只有明确指定测试收件人与邮件内容后才进行真实发送。
5. 验证正常重启、断网编辑和恢复联网。第二个账号在单账号路径通过后加入，检查筛选与发件身份。遇到具体缺口再修复，沿用现有同步机制。

验收记录只保存匿名结论，不保存真实邮件、地址、正文、凭据或 CLI 连接令牌。OAuth、自动注册多个 Agent、内置 AI 和正式安装发布不在本轮范围。


## Gmail 首次连接结果

- 使用专用凭据输入卡取得应用专用密码，账号与密码未写入本记录。
- `imap.gmail.com:993`：系统 CA 校验成功，TLS 登录成功，`INBOX` 只读选择成功；未读取邮件正文。
- `smtp.gmail.com:465`：原生引擎报 SMTP 连接错误；独立 Python TLS 探测收到 `SSLEOFError`。
- `smtp.gmail.com:587`：使用 STARTTLS 的原生接入同样失败；独立 TCP 探测在 SMTP 欢迎信息前读取到 EOF。
- 两种官方 SMTP 配置均在认证前断开，因此不能归因为应用专用密码错误；具体断开方尚未确定，需要检查运行环境的网络路径。
- 未关闭证书校验，未绕过 SMTP 验证保存半成品账号，未发送邮件。没有将只读 IMAP 检查记为完整 Gmail 接入通过。

真实 Agent 草稿交接、GUI 审阅及发送验收等待 SMTP 连通后继续。


## 公司代理环境诊断

用户要求保持公司出口代理配置不变。没有修改系统代理、DNS、路由或证书信任，后续仅在独立诊断中比较了公共 DNS 返回地址，保持主机名证书校验与系统网关不变，没有将 IP、公共 DNS 或自动换路写入产品。

[无凭据连接诊断](../harness/check-gmail-transport.py) 沿当前系统路由执行三个探测，失败退出 1；[本次结果](transport-result.json) 仍为 SMTP 失败。587 只检查 STARTTLS 前的 220 欢迎信息，成功也不等于完成 TLS 或认证。IMAP／465 使用系统 CA 和主机名校验。系统 curl（含强制 TLS 1.2）也复现 SMTP 断连，因此现有证据不支持仅归因于 Paper Reed 的 TLS 实现。

源码核对：MailCore `MCLibetpan.cpp` 在 macOS 启用 CFStream；libetpan `mailstream_cfstream.c` 读取 `CFNetworkCopySystemProxySettings` 并在系统 SOCKS 已启用时设置流代理。这是现有能力的源码证据，不是所有代理类型的兼容性验收。当前系统没有启用的显式代理地址，域名通过公司网关解析到合成地址；透明代理链路具体在哪一跳断开仍未定位。

当前执行环境的应用目录未发现 Spark、Outlook 或 Foxmail，尚未取得同环境下成功客户端的协议连接对照。用户其他客户端正常的反馈保留为重要线索。没有据此假设 OAuth 能修复 SMTP 握手，也没有新增自动换路、盲重试或代理框架。真实 Gmail GUI 接入仍未通过。


## 差异测试与解决边界

[服务器名称／解析路径比较](route-comparison.txt) 由 [无认证探测脚本](../harness/check-gmail-routes.py) 生成：`smtp.gmail.com`、`smtp.googlemail.com` 的系统地址与公共 DNS 地址在 465／587 均断开。补充独立探测：Gmail 25、Microsoft SMTP 587、iCloud SMTP 587 都在欢迎信息前得到 EOF。全部探测未认证或发送邮件。这排除了单个 Gmail DNS 映射和 Paper Reed 特定 TLS 实现作为唯一原因，定位到当前环境无法建立 SMTP 会话；具体关闭连接的设备或出口规则仍没有直接日志证据。

同一公司网络通过系统 curl 访问 `https://gmail.googleapis.com/gmail/v1/users/me/profile` 得到 HTTP 401，TLS 校验结果为 0。这证明 Gmail API 的 HTTPS 路径可达，不证明账号授权或发送已经通过。

不改公司代理配置的候选解决办法是 Gmail HTTPS 发信。Google 官方 `users.messages.send` 要求 OAuth scope，应用专用密码不能替代 OAuth token。需要项目自己的 Google OAuth 桌面客户端，不能复用上游身份。当前正在确认项目注册情况。

最小实施边界：

- 保留现有 IMAP 同步、GUI／CLI 共用草稿、MIME 附件快照和原生发送结果账本。
- 增加明确的 Gmail API 发信分支与项目自有 OAuth 桌面授权；不在 SMTP 失败后静默切换发送通道，避免重复投递。
- API 接受后的 Sent 副本由 Gmail 管理，核对服务器副本；超时仍保留未知结果，不自动重发。
- 不引入云端邮件中转、第二套队列、公共 DNS 回退或新的通用代理框架。
- 先以本机 fixture 验证 API 成功／拒绝／结果未知以及重复提交，再用用户测试账号验证授权和 GUI 草稿交接。真实发送仍需指定内容和收件人。

这是下一步的实施边界，尚未实现或通过 Gmail API 发信验收。

官方依据：[Gmail API send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)、[桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)。
