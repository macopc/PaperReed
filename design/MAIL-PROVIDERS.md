# 邮箱覆盖与接入限制

2026-11-17 核对，代码基线 `46a5756`。这里区分真实验证、已实现通路、仅有配置和尚未接入，不能把服务商选择按钮或上游配置条目直接算作正式支持。当前仍是开发实验版。

## 当前覆盖

| 邮箱／类别 | 当前代码路径 | 已有证据与缺口 |
| --- | --- | --- |
| Gmail 个人邮箱 | IMAP + 应用专用密码收信；项目自有 OAuth + Gmail HTTPS 发信 | 一个真实 Gmail 已授权、收信、发信与重启验证；目前仍要选择开发 OAuth JSON，收信不是完整 Google OAuth。Gmail 的本机稍后／启用规则有已复现缺口。 |
| Google Workspace 自定义域名 | 发现 Google IMAP 后沿用同一路径 | 未做 Workspace 真实租户验证；不应承诺管理员禁用应用密码的组织账号可用。 |
| Outlook / Hotmail / Microsoft 365 国际版 | 自有 Microsoft OAuth、IMAP 收信、Graph HTTPS 发信 | 接入代码、权限契约和原生协议 fixture 已完成；Paper Reed 的统一 Microsoft 应用注册尚未完成，默认构建会提示未配置。真实登录未完成。仍要求账号允许 IMAP。 |
| iCloud Mail、自定义 iCloud 域名 | 显式服务商预设 + IMAP / SMTP | 入口、自动填表和通用协议路径已验证；没有 iCloud 真实收发记录。使用应用专用密码。 |
| QQ / Foxmail、163 / 126 / yeah.net | 内置域名配置 + 通用 IMAP / SMTP | 已有配置表；QQ、163 配置选择已做自动检查。没有逐家真实收发记录，应按服务商要求启用协议与使用授权码。 |
| Fastmail、Yahoo、AOL、Zoho、GMX 等 | 内置域名配置 + 通用 IMAP / SMTP | 有可复用配置与协议通路；Fastmail 配置检查通过，不能据此称所有服务商已实测。账号套餐、应用密码、地区服务器仍需遵守各家要求。 |
| 企业邮箱、自建邮箱、自定义域名 | 自动发现／手动 IMAP / SMTP | 可使用管理员提供的主机、端口、TLS 和凭据。Dovecot 风格本机协议已测；腾讯企业邮、网易企业邮、阿里邮箱等尚无专门兼容性验收。没有固定域名配置不等于不能手动接入。 |
| Proton Mail | 上游已有本机 Bridge 预设，可经通用 IMAP / SMTP 配置 | Paper Reed 尚未验证 Bridge 接入／证书／重启流程，不应称为已支持。没有 Proton 直连接口；Bridge 是可研究的下一条小范围兼容路径。 |

证据：[真实 Gmail](../research/gmail-integration-validation-2026-11-17/README.md)、[服务商代码复用与接入](../research/provider-integration-2026-11-17/README.md)、[多账号发件身份](../research/multi-account-sender-validation-2026-11-17/README.md)、[本轮质量复审](../research/quality-review-2026-11-17/README.md)。

## 明确尚未覆盖的能力

- **完整 Google OAuth 收信与普通用户免开发配置接入**：当前 OAuth 只用于 HTTPS 发信，IMAP 仍依赖应用密码。Google 高级保护禁止使用应用密码，某些组织账号也没有该选项，因此当前路径无法覆盖这类账号。[Google 应用密码说明](https://support.google.com/accounts/answer/185833)、[高级保护说明](https://support.google.com/accounts/answer/7539956)。
- **禁用 IMAP 的 Microsoft 365 租户**：当前没有全 Graph 收信。国际版 Microsoft 项目应用配置、真实授权本身也尚未完成；Outlook.com 默认可能需要用户开启 IMAP。[Microsoft 协议设置](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com)。
- **Microsoft 中国云／政府云、本地 Exchange 专用接入**：代码固定使用国际版登录与 Graph 域名；没有云区域选择、EWS／MAPI／ActiveSync 接入。开放标准 IMAP／SMTP 的本地 Exchange 可以研究通用路径，但不等同于支持所有 Exchange。Microsoft 各云端点及 token 不互通，旧的混合部署 Graph/REST 路径也已退出。[国家云说明](https://learn.microsoft.com/en-us/graph/deployments)、[混合部署 REST 说明](https://learn.microsoft.com/en-us/graph/hybrid-rest-support)。
- **共享邮箱／委派发信的完整工作流**：上游有部分代码，Paper Reed 当前 Microsoft 页面并未接通共享邮箱配置和相应验收，不能算已支持。
- **POP3-only、JMAP-only 邮箱**：Paper Reed 当前没有这些接入路径。Fastmail 可走已有 IMAP，因此无需为了接入 Fastmail 先写 JMAP 引擎。
- **Proton 直连、Tuta**：Proton 应优先研究官方 Bridge，而不是自建解密后端；Bridge 当前需要付费 Proton Mail 计划。Tuta 官方不提供第三方客户端所需的 IMAP／SMTP／POP3，当前无法通过我们的通用路径接入。[Proton 说明](https://proton.me/support/imap-smtp-and-pop3-setup)、[Tuta 说明](https://tuta.com/support/howto)。

## 账号条件不是新协议驱动

iCloud 官方支持 IMAP／SMTP，要求应用专用密码；Yahoo 的非 Yahoo 品牌登录客户端也需要应用密码。Fastmail Basic 不含第三方 IMAP／SMTP 访问；Zoho 当前免费组织方案为 web-only，具体账号与地区条件仍需查其配置页。遇到这些限制，添加一个服务商图标或复制另一客户端驱动并不能解决。[Apple 设置](https://support.apple.com/en-ie/102525)、[Yahoo 应用密码](https://ca.help.yahoo.com/kb/account/generate-manage-rd-party-passwords-sln15241.html)、[Fastmail 说明](https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports)、[Zoho 方案](https://www.zoho.com/mail/help/adminconsole/subscription.html)。

公司代理环境方面，Gmail／Microsoft 已有 HTTPS 发信路径，收信仍走 IMAP；普通邮箱仍走 SMTP。现有实现不能承诺在任意封锁邮件端口的网络里都能连接。后续遇到实际兼容问题时针对所用传输处理，不修改用户路由器配置，也不先引入云端中转服务。

## 下一步取舍

首版的服务商范围基本够用；实现可靠性与正常用户授权还没有收口。先修本轮复审的 Gmail 本机功能、SMTP 拒绝恢复和发送结果问题，再完成 Google／Microsoft 项目身份及普通用户登录体验，随后打包试用。不要求用户逐家提供真实测试账号；自动配置、协议契约和回归覆盖先行，真实兼容性证据逐步补齐。

暂不增加 POP3、全 Graph 同步、Exchange 专用协议或额外 provider 框架。若后续确有目标用户无法使用 IMAP，再根据需求决定扩展；Proton Bridge 可作为独立、范围较小的兼容验证。
