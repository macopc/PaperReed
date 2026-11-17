# 接入范围收敛与 Gmail 入口修正

用户决定取消 Microsoft 渠道，不再注册 Azure / Entra 应用。当前范围：Gmail / Google Workspace、iCloud、普通 IMAP 邮箱。普通 IMAP 配置复用现有实现；各家实际兼容性仍需要积累，不能把预设存在当作实测。

[0038](../patches/0038-provider-scope.patch) 移除 Paper Reed 的 Microsoft 服务商按钮、专用登录页面及路由。通用 IMAP / SMTP 入口保留，不按微软品牌或域名封禁。能使用当前通用认证方式的服务器可自行配置；Outlook.com / Exchange Online 要求的 Microsoft OAuth 仍不在当前接入范围，不能把通用入口视为已兼容它们。上游 Microsoft 协议代码和历史验证不做大规模删除，也不新增阻断所有自定义主机的黑名单。路线图和注册文档已同步，不再把注册当作发布前提。

继续改善现有接入：在其他 IMAP 表单填写 gmail.com / googlemail.com 地址时，隐藏密码和手动服务器入口，提供 Google 登录按钮；选择服务商时重新建立页面栈，返回能够正确回到服务商选择。Google Workspace 自定义域名仍可从 Google 入口登录，不增加额外域名探测。

验证：完整 TypeScript 检查；实际开发版 Electron 首用流程（移除 Microsoft 入口、Gmail 引导、返回、iCloud 预设、普通 IMAP 连接失败／成功、重连、CLI、草稿恢复、发送和归档）；38 个补丁重放及源码比对通过（含删除专用页面）。邮件检查仅使用 loopback fixture，未访问真实邮箱或发送真实邮件。开发版结果见 [记录](development-ui-result.json)。

macOS `.app` 已重新构建，打包版也完成相同完整流程，fixture SMTP 恰好一封；见 [打包版结果](packaged-ui-result.json)。

后续优先继续 Gmail 真实统一授权与日用体验、iCloud / 普通 IMAP 兼容性和 macOS 分发；不再推进 Microsoft。
