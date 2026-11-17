# Paper Reed 的 Microsoft 应用注册

适用于只有普通微软账号、还没有 Azure / Microsoft Entra 目录的项目维护者。2026-11-17 核对。普通使用者无需自己注册应用；发行版应统一带上 Paper Reed 的 client ID。

## 费用和准备

应用注册通常没有单独费用，不需要购买虚拟机、数据库、Microsoft 365 或 Entra P1/P2。没有 Entra 目录时，微软官方建议从 [Azure 免费账号](https://azure.microsoft.com/free/) 开始。可以用普通微软账号登录；没有账号则先注册。按地区和账号资格，流程可能要求手机号、银行卡验证，并可能有临时 1 美元预授权。不要为了注册应用创建收费资源或升级订阅。[注册前提](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)、[免费账号与验证说明](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account)。

使用免费账号附带的**默认目录**。不要从“新建租户”另建一个目录：微软目前限制免费／试用客户创建额外 workforce tenant，这和使用已有默认目录注册应用不是同一步。[租户创建限制](https://learn.microsoft.com/en-us/entra/fundamentals/create-new-tenant)。

普通 Graph 邮件 CRUD 属于标准 API，在规定用量内没有额外的按调用计费；企业邮箱本身的订阅是另一回事。[Graph API 费用分类](https://learn.microsoft.com/en-us/graph/metered-api-overview)。免费账号资格和验证能否通过由微软决定。

## 1. 注册应用

登录 [Microsoft Entra 管理中心](https://entra.microsoft.com/)，确认当前是自己的默认目录，然后进入：

**Identity / 标识 → Applications / 应用程序 → App registrations / 应用注册 → New registration / 新注册**。

| 项目 | 填写值 |
| --- | --- |
| 名称 | `Paper Reed` |
| 支持的账号类型 | **任何组织目录中的账号和个人 Microsoft 账号**（Accounts in any organizational directory and personal Microsoft accounts） |
| 重定向 URI | 可先留空，在下一步按桌面平台添加 |

这使同一个应用能够接入 Outlook / Hotmail 个人邮箱，以及组织允许的 Microsoft 365 邮箱。创建后保留 Overview / 概述页的 **Application (client) ID / 应用程序（客户端）ID**，不要误拿 Object ID。[官方注册步骤](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)。

## 2. 设置桌面回调

进入 **Authentication / 身份验证 → Add a platform / 添加平台 → Mobile and desktop applications / 移动和桌面应用程序**，添加自定义重定向地址：

```text
http://localhost:12141/desktop
```

这是当前 Paper Reed 系统浏览器 + PKCE 流程实际使用的地址。不要选 Web / SPA 平台，不要改为第三方应用地址，也不要套用 MSAL 示例的其他回调协议。当前流程不需要创建 client secret。用于 device code / 密码登录等无回调流程的 “Allow public client flows” 开关不属于本项目当前必需配置。[桌面平台说明](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration)。

## 3. 一次添加当前代码所需权限

进入 **API permissions / API 权限 → Add a permission / 添加权限**。以下全部选择 **Delegated permissions / 委托的权限**，不要选 Application permissions / 应用程序权限。

| API | 权限 | 用途 |
| --- | --- | --- |
| Microsoft Graph | `openid`、`email`、`profile`、`offline_access` | 登录身份和持续授权 |
| Microsoft Graph | `User.Read` | 核对登录的邮箱身份 |
| Microsoft Graph | `Mail.ReadWrite` | Graph 草稿、附件和已发送副本 |
| Microsoft Graph | `Mail.Send` | HTTPS 发信 |
| Office 365 Exchange Online | `IMAP.AccessAsUser.All` | IMAP 收信和整理 |
| Office 365 Exchange Online | `SMTP.Send` | 与当前复用的原生邮件 token 请求保持一致 |

Exchange Online 通常位于 **APIs my organization uses / 我的组织使用的 API**，搜索 `Office 365 Exchange Online`。Graph 的身份权限可能显示在 OpenId permissions 分组下，`User.Read` 也可能已默认添加。无需联系人、日历或 POP 权限。

当前发送走 Graph，不会在失败后切回 SMTP；SMTP 权限保留是因为现有原生 token manager 按 IMAP + SMTP 这一组邮件 scope 换取 token。若以后精简这一组，必须同时修改授权和刷新请求，不能只删后台权限。

权限加到应用配置后，仍需用户登录授权；组织邮箱还可能受租户管理员同意策略限制。[协议 OAuth 与 scope](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)、[Graph 权限参考](https://learn.microsoft.com/en-us/graph/permissions-reference)。

## 4. 配置到 Paper Reed

将 **Application (client) ID** 交给维护者即可；它不是密码。不需要发送账号密码、银行卡信息或客户端 secret。

开发启动可用：

```sh
PAPER_REED_MICROSOFT_CLIENT_ID='应用程序客户端-ID' python3 scripts/start-desktop.py
```

也可在当前开发配置中设置 `core.paperReed.microsoftClientId`。发布前应把项目 ID 统一带入发行配置，不要求最终用户设置环境变量。

完成注册后，再验证真实 Microsoft 授权、刷新、IMAP 连接和 Graph 发信。Outlook.com 用户可能还需要在邮箱设置中启用 IMAP；组织策略和发布者验证也可能影响公众或企业用户授权。当前项目的协议 fixture 通过不等于真实服务商已验证。若免费账号入口拒绝账号资格或后台提示无注册权限，记录页面错误再判断原因，不要因此直接购买套餐。
