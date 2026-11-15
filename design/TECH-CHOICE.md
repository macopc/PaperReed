# 首版技术选型

2026-11-15 · 第一轮结论：推荐进入验证的路线，不是已完成邮箱集成或获准发布。行为依据为 [MAIL-CORE.md](MAIL-CORE.md)，不改变当前界面基线。

后续进展见 [macOS 本机验证](../research/native-validation.md)：完整源码与依赖已准备，TS 检查通过；源码编译受本机 Xcode 组件阻塞。预编译引擎在仅本机网络下通过 8 个协议场景实例，支持无自建业务服务端的方向，尚不等于真实邮箱接入通过。

**建议优先验证 Mailspring 产品分支，保留 Electron、React / TypeScript、C++ 同步引擎和 SQLite。** 重做 Paper Reed 的界面及共享操作入口，补齐草稿冲突与发送结果语义。Zero 用作接口和交互参考；不把其云端后端迁入桌面。若关键验证无法收敛，再转向 Electron + 自建小核心。

理由是减少首版需要自行承担的邮件同步工作，不是判断 Electron 比其他框架更美观。当前原型的字体、排版、颜色与交互可继续作为目标；长列表、中文输入、编辑器、键盘和 macOS 窗口行为仍需在真实应用中验证。

## 1. 比较的是完整交付成本

| 路线 | 可利用的基础 | 我们仍需承担的工作 | 本轮判断 |
| --- | --- | --- | --- |
| Mailspring 产品分支 | 账号、缓存查询、同步、草稿编辑、任务与通知、本机 MCP | 重做 UI；统一编辑入口；补齐持久去重与发送阶段；处理上游服务、构建与分发依赖 | **优先验证**，允许有限的 C++ 修改 |
| 新建 Electron + React / TS + SQLite，使用 ImapFlow / Nodemailer | 桌面运行时、IMAP 访问、MIME 组装与 SMTP 发送库 | 自己实现同步进度、位置映射、会话、搜索索引、任务恢复与服务商差异 | **备用**；代码起点干净，邮件工程责任更多 |
| Zero 改成本机客户端 | 服务商 driver、草稿与 Agent 接口、现有 Web 交互 | 替换 Workers / Durable Objects / 存储绑定，建立本机生命周期与缓存，重新核验多账号边界 | 首版不采用；不能只套一个桌面窗口 |
| Tauri 或 SwiftUI + 邮件核心 | 另一种桌面呈现与系统集成方式 | 仍需选择／建立邮件引擎；复用 Mailspring 时还需重接查询、任务、编辑器和通知 | 暂不进入第一轮；没有测量证据支持为此提前迁移 |

ImapFlow 是 IMAP 客户端库，Nodemailer 提供邮件组装与发送；“自建同步、缓存和恢复”是本项目对工作量的判断，不是这些库缺陷。[ImapFlow 文档](https://imapflow.com/docs/)、[Nodemailer 文档](https://nodemailer.com/)。Tauri 使用系统 WebView 与 Rust 核心；替换桌面壳不能代替邮件底座验证。[Tauri 架构](https://v2.tauri.app/concept/architecture/)

不做无测量依据的性能打分，不承诺包体、内存或开发周期。也不同时维护两套原型核心。

## 2. 推荐组合及边界

| 部分 | 实验选择 | 边界 |
| --- | --- | --- |
| 产品代码 | 固定版本的 Mailspring 产品分支 | 先保留启动、账号、查询和编辑链路；不先把 C++ 引擎抽成独立通用 SDK |
| 桌面与 UI | Electron + React / TypeScript，沿用基线工具链 | 当前基线 React 为 17.0.2；不同时迁移到新 React、Tauri 或新状态框架。产品 UI 按 Paper Reed 重做 |
| 收发与同步 | Mailspring-Sync；先一般 IMAP / SMTP，再验证 OAuth 账号 | 每账号一个引擎进程；保留现有进程管理。Outlook 等能力以实测为准，不承诺所有邮箱都能走同一协议 |
| 持久化与查询 | 原 SQLite、查询通知与任务机制 | 不叠加 ORM、云数据库或第二套任务队列。产品本机状态可扩展原数据库，但不复用会上传的元数据通道 |
| 邮件操作 | TS 共享入口 + 必要的引擎约束 | UI 和 CLI 的草稿保存／发送都经过它；真正的版本比较和去重必须落在原子写入边界 |
| CLI | TS 薄客户端，先复用经认证的 loopback 接口 | CLI 是首要入口；MCP 只是可复用传输。用户无需为使用产品安装 Node，随应用分发方式需打包验证 |
| 邮件展示／编辑 | 先复用现有正文处理和编辑能力 | 保留 Paper Reed 的阅读／回复一体结构；隔离不可信 HTML，验证 Cc/Bcc、引用、换行、附件与中文输入 |
| 凭据与授权 | macOS 系统凭据存储；本机自动化授权与邮箱凭据分离 | Paper Reed 使用自己的应用身份与 OAuth 注册；不沿用上游服务凭据或账号身份 |

这里的“共享入口”是一组应用内函数及操作结果，不是新的业务服务器。引擎已有协议、数据库和任务结构先保留；CLI 不直接写 SQLite。独立消息总线、插件系统、云端账号系统和内置 AI 均不进入首轮。

部署目标是 macOS 本机应用直接连接邮箱服务商，无需 Paper Reed 自建业务服务端。OAuth 应用注册和发布托管仍需配置；外部 Agent 所用模型可能是云服务。本机 CLI 监听不等于公网后台，离线缓存能力也不等于可以离线收发邮件。

## 3. 源码确认的适配缺口

### 草稿：有版本号，不等于有冲突保护

MCP 可以创建普通和回复草稿，但注册表没有 `update_draft`；发送仅接收 `headerMessageId`，没有 `expectedRevision` 或请求去重标识。编辑会话会保留尚未保存的字段；引擎 `performLocalSaveDraft` 接受传入内容，然后增加现有版本号，并不比较调用者读到的版本。[MCP 工具](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/internal_packages/mcp-server/lib/mcp-tools.ts)、[编辑会话](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/src/flux/stores/draft-editing-session.ts)、[草稿写入](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/TaskProcessor.cpp)

因此不能只在 CLI 前面读一次版本再写入。实验需让 UI / CLI 保存与发送共用原子校验；界面有未保存编辑时，交给 Agent 前先保存，冲突时保留双方内容并提示重新读取，不自动合并。优先复用同一草稿和原存储，不再建平行草稿库。实际是否能直接把上游 `version` 用作产品修订号仍需验证。

### 发送：已有保护，但完成语义不满足要求

上游 MCP 在入队后即返回 `sent: true`；隔离检查确认，重复调用同一缓存草稿会创建两个发送任务。这证明处理器没有合并请求，不证明真实服务器已经收到两封信。[处理器](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/internal_packages/mcp-server/lib/mcp-tools.ts)

引擎发送前持久设置 `_performRemoteRan`，可阻止同一个任务反复执行；但已有该标记时直接返回，外层正常结束会把任务标为 `complete`。**从控制流推断，发送中崩溃后的恢复不能仅凭此状态证明服务器已接受。** 此项尚未运行崩溃注入实验。正常失败也会出现 `complete + error`；已发送副本写入失败则可能只记录日志。[TaskProcessor](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/TaskProcessor.cpp)

需要补齐三个持久信息：请求与草稿修订的对应关系、发送提交阶段、已发送副本状态。映射成核心设计的操作结果；不重写 SMTP。上游还会清理旧完成任务，不能直接把临时任务历史当永久去重依据。最小方案是在同一数据库保留紧凑请求结果；裁剪策略确定前，不删除仍可能被重试的发送记录。

Agent 任务还需保存来源与授权范围，并在远端执行前重新检查；只在 MCP 入口校验不足以满足“撤销授权后停止待执行任务”。这些改动需包含 UI 发起的共享操作路径，不能让旧发送入口绕过草稿冻结和去重。

### 本机整理：不能直接调用同名上游功能

上游稍后功能会修改服务端文件夹／标签；其元数据同步路径可以连接 Mailspring identity 服务。Paper Reed 的本机稍后和本机标签要保存在明确的本机状态中，不走这些路径。[稍后操作](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/internal_packages/thread-snooze/lib/snooze-utils.ts)、[元数据 worker](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/MetadataWorker.cpp)

### Zero：驱动抽象值得参考，运行环境不直接匹配

当前 driver 包含 Google、Microsoft、IMAP，不能沿用“只支持 Gmail”的旧印象。但 IMAP 默认环境依赖 Cloudflare socket、凭据加密配置和对象存储；部署配置还包含 Durable Objects 和队列。隔离检查复现了 MCP 切换账号后部分 handler 仍使用初始化账号的行为。[driver](https://github.com/Mail-0/Zero/blob/36132735ca3b734b23f48127f9271c80d1ba76e7/apps/server/src/lib/driver/index.ts)、[IMAP 依赖](https://github.com/Mail-0/Zero/blob/36132735ca3b734b23f48127f9271c80d1ba76e7/apps/server/src/lib/driver/imap.ts)、[部署配置](https://github.com/Mail-0/Zero/blob/36132735ca3b734b23f48127f9271c80d1ba76e7/apps/server/wrangler.jsonc)、[MCP](https://github.com/Mail-0/Zero/blob/36132735ca3b734b23f48127f9271c80d1ba76e7/apps/server/src/routes/agent/mcp.ts)

因此本轮不移植 Zero 后端。可以学习显式账号上下文、服务商差异封装和 Agent 交接方式，但不复制它的运行拓扑。

## 4. 独立产品必须先验证的事项

- **构建可维护。** 上游安装脚本有下载预编译 mailsync 的路径；我们的发送语义需要修改 C++，所以只跑下载好的引擎不足以通过选型。必须从固定源码构建、运行，再验证自己的打包产物。[安装脚本](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/scripts/postinstall.js)
- **不依赖上游产品账号。** 引擎源码接受空 identity，元数据 worker 此时退出；这只是源码证据。需验证完整客户端在不登录 Mailspring 服务时的收发、更新和错误处理，整理仍残留的上游服务调用。[引擎入口](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/main.cpp)
- **OAuth 是接入工作，不是按钮。** 使用 Paper Reed 自己的注册，验证系统浏览器授权、回调、刷新和撤销；公开分发涉及的验证另行核实。测试账号授权成功不代表可向所有用户发布。[Google 桌面授权](https://developers.google.com/identity/protocols/oauth2/native-app)、[Microsoft 桌面配置](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration)
- **保留开源来源。** 已查看 Mailspring / Sync 的 GPLv3 文件和 Zero 的 MIT 文件；产品分支保留来源与声明，替换品牌、应用标识及分发配置。依赖清单和分发条件仍需在构建时核对，不把源码可读当成所有素材、服务均可直接使用。

## 5. 只做一个决定路线的实验

| 顺序 | 内容 | 通过条件 |
| --- | --- | --- |
| A：构建与接入 | 完整固定源码、编译引擎、启动隔离数据目录；先测试 IMAP / SMTP，再一个 OAuth 服务商 | 自己的构建能收信；不读取现有用户邮箱配置；不依赖上游产品登录；第二账号授权和刷新可用 |
| B：共享草稿 | CLI 创建回复，界面继续编辑；带 Cc/Bcc、中文换行、附件和回复引用 | 两端同一草稿；旧修订被拒绝；重启内容不丢；交接前未保存内容不会被覆盖 |
| C：发送结果 | 用户在界面发送；CLI 查询；重复请求、丢响应、发送前后崩溃、已发送副本写入失败 | 不把入队当接受；重复请求关联同一结果；不确定时不自动重发；副本失败不重投 |
| D：账号与呈现 | 第二账号、归档、重启恢复；用当前列表和回复布局展示真实数据 | 操作不串账号；没有两套缓存；窗口／后台生命周期可用；列表滚动与输入无明显卡顿并记录测量条件 |

发送只使用专用测试账号与测试收件人。B / C 可先利用本地协议测试服务做故障注入，随后仍需真实服务商验证。**本轮只完成源码与隔离处理器验证；A–D 均未完成。** 不在尚未选定底座时迁移全部页面。

通过后采用推荐组合，并更新架构为实施方案。若独立构建／授权不可行，或为了草稿与发送正确性必须重写大段同步逻辑，停止扩大分支，改用备用 Electron 路线做同一实验。不能为了保留 Mailspring 而降低邮件核心的验收要求。

## 6. 本轮证据范围

2026-11-15 在线核验：Mailspring 默认分支仍为 `535f13dd`，Zero 为 `36132735`；Mailspring 该提交固定的 Sync 子模块是 `8681eae1`。Sync 独立仓库头已到 `beea1dba`，领先 49 个提交，**不把它自动混入当前基线**。另读了新头的 `TaskProcessor.cpp`，上述草稿保存、发送标记及任务清理行为仍存在；没有宣称两种版本组合已经兼容。

本机关键文件与原 [source-manifest.json](../research/source-manifest.json) 的 blob 指纹吻合。重新运行原 8 项隔离检查，新增重复发送入队与草稿接口缺口两项，共 **10 项通过**。通过表示成功复现观察，包括缺口，不表示客户端合格。复现命令及结果见 [选型验证记录](../research/tech-selection-validation.md)。

尚未编译 C++、运行完整 Electron、授权真实邮箱、测量内存／性能或签名公证。当前推荐基于代码结构与适配成本判断，不能用隔离测试替代这些证据。
