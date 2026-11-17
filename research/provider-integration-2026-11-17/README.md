# 第二家服务商接入与开源代码复用

2026-11-17。上一轮改动已推送到 `main`：`692ab49`。三类接入均纳入实现，不以用户逐家提供真实测试账号为前提。本文分别记录源码复用、协议／界面验证和仍需项目方完成的发布配置。

## 结论

继续使用 Mailspring / Mailcore 的现有收发、账号和凭据机制。普通 IMAP 邮箱主要补配置与真实验证；Microsoft 补自己的 OAuth 接入并复用已有 Graph 发信。没有必要为了第二个服务商增加一层统一 provider 框架，或搬入 Zero 的服务端。

### Mailspring：直接复用，已经在底座里

检查固定版本桌面 `535f13dd463536f36728bce3efb4ae0d51ab3f19`、引擎 `8681eae1d217d993e4d4dc7de17ae8b91fc3da49` 及 Paper Reed 当前补丁：

- [onboarding-helpers.ts](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/internal_packages/onboarding/lib/onboarding-helpers.ts)：现成的域名／MX 配置匹配、自动配置、SRV 与账号构建。内置表已有 iCloud、QQ、163、Fastmail 等条目；这说明无需为每家编写新协议驱动，不代表这些条目都已真实验证。
- [NetworkRequestUtils.cpp](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/NetworkRequestUtils.cpp) 和 [XOAuth2TokenManager.cpp](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/XOAuth2TokenManager.cpp)：Microsoft 刷新与 IMAP／Graph 不同 audience 的 token 管理。
- [TaskProcessor.cpp](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/TaskProcessor.cpp)：MIME 建立 Graph 草稿、附件、提交发送、使用 immutable ID 查找 Sent 副本。不需要再写一套 Graph 邮件核心。

沿用现有 GPLv3 来源与归属。**复用代码不包含复用 Mailspring 的 OAuth 应用身份。** 其默认 client ID 和第三方完成页不能作为 Paper Reed 正式接入；现有授权 scope 还包含联系人和日历，不能不加区分地照搬。

### Thunderbird：借鉴配置和权限划分

[OAuth2Providers.sys.mjs](https://github.com/mozilla/releases-comm-central/blob/master/mailnews/base/src/OAuth2Providers.sys.mjs) 将 hostname、issuer 和协议所需 scope 分开；Microsoft 的 IMAP、SMTP 与 Graph 权限明确区分，并通过 offline_access 获取刷新能力。适合用来核对接入差异，不需要复制整个 Gecko 登录体系。

[ISPDB / autoconfig](https://github.com/thunderbird/autoconfig) 是现成的邮箱配置数据源，仓库声明 MPL-2.0；Mailspring 已有从 ISPDB 派生的配置和查询逻辑，先复用这一条路径，不再加第二个发现服务。本轮未复制 Thunderbird 源文件或配置数据。

### Zero：参考 Graph 行为，不整体移植

检查既有研究固定版本 `36132735ca3b734b23f48127f9271c80d1ba76e7`：

- [microsoft.ts](https://github.com/Mail-0/Zero/blob/36132735ca3b734b23f48127f9271c80d1ba76e7/apps/server/src/lib/driver/microsoft.ts) 已有 Graph 文件夹、草稿、回复、附件与发送，可参考 API 映射。但构造时从 Hono context / auth 获取 token，并使用其 MailManager 类型；直接接入会要求迁移这些边界。
- [imap.ts](https://github.com/Mail-0/Zero/blob/36132735ca3b734b23f48127f9271c80d1ba76e7/apps/server/src/lib/driver/imap.ts) 的默认运行路径使用 Durable Object SQLite 索引、R2 缓存、Cloudflare socket 和服务器凭据加密。可研究实现细节，不适合作为当前本机引擎的替换件。
- 此版本 [LICENSE](https://github.com/Mail-0/Zero/blob/36132735ca3b734b23f48127f9271c80d1ba76e7/LICENSE) 为 MIT。许可允许的复用范围与移植成本是两回事；本轮未复制其生产代码。

### MailKit：借鉴桌面 OAuth 流程

[ExchangeOAuth2.md](https://github.com/jstedfast/MailKit/blob/master/ExchangeOAuth2.md) 给出桌面 public client、按协议取 token、XOAUTH2 和登录后账号身份选择的可运行 C# 示例。适合用来交叉核对流程；引入 .NET 邮件栈对现有 Electron / C++ 项目没有必要。

## 第二家实际怎么接

- **Outlook / Hotmail / Microsoft 365**：复用已有 OAuth IMAP 收信 + Graph HTTPS 发信；接入 Paper Reed 自己注册的 Microsoft 桌面应用。使用系统浏览器、PKCE、本机回调，授权结果写入原 KeyManager。应用 client ID 由项目方统一注册／配置，最终用户只需登录；组织账号仍受其租户策略影响。Microsoft 官方说明 Outlook.com 需要 OAuth2，并需启用 IMAP：[服务器设置](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com)、[协议授权](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)、[桌面注册](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-registration)。
- **iCloud / QQ / 163 / Fastmail 等普通 IMAP**：使用已有自动配置和 IMAP / SMTP 引擎，按所选服务商要求获取应用密码或授权码，再验证当前网络下的收发；不因已有配置表就宣称已支持。
- **Proton Mail**：接入官方 Bridge 暴露的本机 IMAP / SMTP，不把解密层搬进 Paper Reed。Bridge 当前要求包含 Proton Mail 的付费方案，见 [官方说明](https://proton.me/mail/bridge)。

开发验证使用协议 fixture、生产授权模块与实际桌面流程，覆盖账号加入、读取、草稿、发送、重启与错误处理。发布后再逐步积累真实服务商兼容性记录；不要求用户为每家服务商创建测试邮箱。暂不扩展别名管理、共享邮箱或全 Graph 同步。

## 已执行的 Microsoft 复用验证

使用现有编译引擎与上游本机 fixture，无外网邮箱、无真实发信：

1. `graph-account-test`：SMTP AUTH 禁用时，IMAP + Graph 接入检查通过，不尝试 SMTP。
2. `graph-account-test-not-consented`：缺少 Graph 权限时返回相应认证失败。
3. 新增 [check-microsoft-send.py](../harness/check-microsoft-send.py)，将上游 fixture 接到 Paper Reed 的持久草稿与发送结果契约。

新测试实际发现：第一次 `/send` 返回 503 后，上游通用请求函数再次 POST，最终提交了两次请求。修正为最终发送请求不自动重试；明确拒绝和提交前失败标记 rejected，503／响应丢失标记 unknown。继续使用原持久发送记录，重启／相同请求重入不再次提交，也不切回 SMTP。

[0028 原生补丁](../patches/0028-microsoft-send-boundary.patch) 只修改三个现有源码文件；没有新增第三方运行依赖、服务或队列。5 项发送检查通过：成功（含 To/Cc/Bcc 和唯一 Sent 副本）、403 拒绝、503、响应丢失、Graph 刷新授权拒绝。每项检查重启及相同请求重入；所有场景 SMTP 提交均为零。见 [results.json](results.json)。原生 Release 构建通过，全部 28 个补丁重放后与已测试源码一致。

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-microsoft-send.py \
  --upstream research/.local/Mailspring \
  --binary research/.local/derived-data/Build/Products/Release/mailsync \
  --output research/.local/microsoft-send-validation
```

开发引擎已重新构建并替换 `app/mailsync`；打包应用仍需重新构建。下面记录桌面接入的后续实现。


## 三类桌面接入已实现（0029）

[0029 桌面补丁](../patches/0029-provider-onboarding.patch) 在已有上游模块中完成接入，仅新增一个很薄的 Microsoft 页面组件：

- 服务商选择页提供 Gmail、Outlook / Microsoft 365、iCloud Mail、其他 IMAP 四个入口；添加第二个账号和首次启动使用同一流程。
- Microsoft 复用既有 OAuth 页面、PKCE、code exchange、账号模型、加密凭据和原生连接测试。使用项目自己的 client ID；不回退到 Mailspring 的 ID，不跳转到其授权完成页。授权完成在本机显示；监听仅绑定 loopback，同一个 code 仅处理一次。
- Paper Reed 仅请求邮件与身份所需的 scope，不请求上游联系人／日历权限。IMAP 和 SMTP scope 仍按上游原生 token manager 的协议 audience 一并申请；实际发信显式走 Graph，失败不会改走 SMTP。
- 缺少 refresh token 或 Graph 邮件权限时不保存账号；重新连接时拒绝与原账号不匹配的身份。Microsoft 连接设置使用官方 IMAP 主机，避免套用旧的 Outlook 域名配置。
- iCloud 使用现有预设，支持 iCloud 域名及用户明确选择 iCloud 的自定义域名；IMAP 993 TLS、SMTP 587 STARTTLS，提示使用应用专用密码。依据 [Apple 配置说明](https://support.apple.com/en-mt/102525)。
- 普通 IMAP 复用现有域名配置、MX、Thunderbird autoconfig、SRV 和手动表单。明确域名／服务商预设先于 Mailcore 的宽泛匹配，修正 `qq.com` 被误配成腾讯企业邮箱的问题。仍允许用户在连接前核对、修改服务器。
- 返回选择和重填可用；自动配置失败会结束加载并显示错误，手动入口不依赖自动发现服务。

### 自动验证

[14 项授权／配置检查](onboarding-contract-results.json) 执行生产 TypeScript 模块，覆盖项目身份、PKCE、权限缺失、token 缺失／拒绝、重新连接身份、取消授权、本机回调和重复 callback，以及 iCloud、自定义 iCloud 域名、QQ、163、Fastmail、自定义域名 autoconfig。HTTP 身份与发现响应使用 fixture，不能当作各服务商已实测。

[桌面流程结果](onboarding-ui-result.json) 使用实际开发版 Electron 和隔离 IMAP / SMTP：选择三类入口、Microsoft 未配置状态、iCloud 自动填写、返回切换；随后完成普通 IMAP 首次连接、错误密码、安装 CLI、阅读、回复草稿、重启恢复、过期凭据重连、GUI 发信与归档。fixture SMTP 恰好一封；测试使用独立 MCP 端口，不干扰正在运行的其他配置。

```sh
node research/harness/check-provider-onboarding.cjs research/.local/Mailspring
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-first-run.py \
  --upstream research/.local/Mailspring \
  --output research/.local/provider-onboarding-results
```

完整 TypeScript 检查与 29 个补丁重放通过，105 个源码文件与已测版本一致。首轮 UI 检查的页面过渡选择器重复、固定 MCP 端口占用只修正测试 harness，没有为此增加产品重试逻辑。

### Microsoft 统一应用配置

这是一项项目发布配置，不是要求每个用户或每种邮箱提供测试账号：项目方注册支持个人账号和工作／学校账号的 Microsoft public desktop application，注册本机回调 `http://localhost:12141/desktop`，然后设置 `PAPER_REED_MICROSOFT_CLIENT_ID`，或开发配置 `core.paperReed.microsoftClientId`。不需要客户端 secret，不使用第三方项目身份。

当前授权请求包含 `openid email profile offline_access User.Read Mail.ReadWrite Mail.Send` 与 `https://outlook.office.com/IMAP.AccessAsUser.All`、`https://outlook.office.com/SMTP.Send`。正常发行版本应统一带上项目 ID；未配置的开发版明确显示“Microsoft 登录尚未配置”，不伪装成已连通。组织管理员是否允许该应用属于 Microsoft 租户政策。

本轮已经完成接入代码及自动验证；Microsoft 项目注册、真实授权和 macOS 正式分发尚未完成。IMAP/SMTP 的实际可达性仍取决于服务商及用户网络，不改变系统／路由器代理，也不承诺任意网络都可访问邮件端口。
