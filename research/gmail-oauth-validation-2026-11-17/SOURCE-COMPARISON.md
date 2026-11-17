# Gmail 授权：成熟代码对照与剩余工作

2026-11-17。按用户要求以实际源码核对接入路线，不要求用户逐家提供真实邮箱后才继续实现。没有引入新的邮件栈、OAuth 框架或服务端。

## 源码对照

- **Mailspring**，本地研究固定版本 `535f13dd463536f36728bce3efb4ae0d51ab3f19`：[onboarding-helpers.ts](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/internal_packages/onboarding/lib/onboarding-helpers.ts) 的 `buildGmailAccountFromAuthResponse` 交换 code、读取身份、把 refresh token 放入账号设置、调用原生连接检查。其 scopes 包含完整邮件权限，也包含本项目不需要的联系人／日历权限。Paper Reed 复用账号、凭据存储和连接检查，仅请求身份和邮件权限。
- **Mailspring-Sync**，固定版本 `8681eae1d217d993e4d4dc7de17ae8b91fc3da49` 的 [XOAuth2TokenManager.cpp](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/XOAuth2TokenManager.cpp)：缓存 access token、到期前刷新、更新返回的新 refresh token。Paper Reed 0036 直接复用这套管理，只接入自己的 Google client 配置，并让 IMAP 与 HTTPS 发信共用缓存。
- **Thunderbird**，[OAuth2Providers.sys.mjs](https://github.com/mozilla/releases-comm-central/blob/master/mailnews/base/src/OAuth2Providers.sys.mjs)（本次读取主分支）：Google 的 IMAP / SMTP 映射到同一 `https://mail.google.com/` scope，配置 PKCE 与外部浏览器。代码明确要求其他应用注册自己的应用身份；不能因为源码开放就复用 Thunderbird 的 client ID。Paper Reed 当前实现与这些关键选择一致。
- **MailKit**，[GMailOAuth2.md](https://github.com/jstedfast/MailKit/blob/master/GMailOAuth2.md)（本次读取主分支的可运行示例，不冒充生产客户端）：使用 Google 身份库、桌面授权流程、本机 callback、过期刷新，再将 access token 交给 IMAP SASL 认证。说明成熟邮件协议栈与授权层可以分开复用；无需为此给现有 Electron / C++ 项目引入 .NET。

本轮只研究 Thunderbird / MailKit，没有复制它们的生产代码或应用身份。Mailspring 本来就在当前底座中。主分支参考可能变化，上述固定版本 Mailspring 链接作为可重现的核心依据。

## 当前状态

统一授权代码已完成：PKCE + state、本机回调、身份匹配、完整邮件 scope、加密 refresh token、原生 IMAP OAuth、HTTPS 发信、共享缓存、旧账号主动重连迁移、取消不保存。此前已执行授权模块、真实引擎 loopback 和桌面集成检查，见 [验证记录](README.md)。源码对照没有发现需要重写整个授权方案的理由。

剩余工作应分开处理：

1. **发行配置**：将 Paper Reed 自己的 Google Desktop client 配置交给现有打包入口。最新本机包尚未内置真实配置；不是每个用户需要选 JSON。
2. **真实接入验收**：已有 send-only grant 不能自动获得 IMAP 权限，需要一次新的用户授权。可以后做，不作为其他开发的前提，也不能以阅读他人源码替代“我们的项目真实接入已通过”的证据。
3. **公众发行**：Google 所需应用验证、macOS 签名／公证和更新发布流程仍未完成。当前首版界面、可访问性、性能和日用体验也未全部验收。

推荐继续做现有接入的错误提示、日用体验与分发准备；真实授权列为独立验收项，不再重复阻塞开发。

## Microsoft 的通用 IMAP 边界

取消专用 OAuth 注册和入口，保留通用 IMAP / SMTP 表单，不加邮箱域名黑名单。可采用当前通用认证方式的服务器仍可尝试连接。

但 IMAP 是邮件协议，不是登录方式。Outlook.com 官方要求 Modern Auth / OAuth2；Exchange Online 的 IMAP OAuth 也依赖 Microsoft 应用注册。因而不能承诺把邮箱填进通用 IMAP 表单就绕过应用身份。Thunderbird 的 provider 映射同样为 Microsoft 邮件服务器选择 Microsoft OAuth。[Outlook 官方设置](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com)、[Microsoft IMAP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)。本项目不再要求用户为此注册。
