# 源码研究

当前可下载 [0.0.2 桌面测试版](https://github.com/macopc/PaperReed/releases/tag/v0.0.2)，由固定版本的 Mailspring 和 Mailspring-Sync 加上 [Paper Reed 补丁](patches/README.md) 构建。下文保留各阶段的研究、设计取舍和当时的验证边界。

[真实 Gmail 日用闭环](daily-use-validation-2026-11-17/README.md) 完成统一授权、重启连接、同步中搜索阅读与 Codex 草稿回 GUI 审阅；0046 修复返回列表丢失焦点。本轮无真实发送，公开证据已脱敏。

[首次打开邮件的长任务](reader-task-validation-2026-11-17/README.md) 已定位到图标目录扫描，0045 仅调整目录读取方式，保存了三次完整负载 Trace、截图与映射兼容性检查。

实现进展：[CLI / GUI 共用草稿与发送结果接口](shared-core-validation.md)，包括可应用补丁、实验 CLI、真实引擎交接与请求重试检查。

后续 [真实写信窗口交接](compose-handoff-validation.md) 已通过 CLI 建稿、GUI 自动保存／发送、旧 CLI 修订拒绝与结果查询；[反向未保存编辑冲突](unsaved-conflict-validation.md) 已复现并修复关闭窗口丢失输入的问题；后续 [另存副本与重启恢复](recovery-copy-validation.md) 已通过文本草稿路径。[Paper Reed 界面接入](ui-validation-2026-11-16/README.md) 开始连接真实数据与编辑状态；附件、真实服务商与完整设计验收仍待完成。

选型入口：[首版技术选型](../design/TECH-CHOICE.md) 与 [首轮验证记录](tech-selection-validation.md)。当前推荐优先验证 Mailspring 产品分支；自编译引擎已通过本机协议回归，真实服务商与分发构建仍待验证。

[macOS 本机验证](native-validation.md) 补充完整源码准备、构建阻塞，以及仅本机网络下预编译引擎的协议运行结果；同时明确“不需要自建业务服务端”的适用边界。

[邮件核心契约验证](engine-contract-validation.md) 用真实引擎复现旧草稿覆盖、两个任务重复发送，以及两种 SIGKILL 后任务误报完成的情形。后续 [修复实验](engine-fix-validation.md) 提供引擎与桌面源码补丁。11 月 16 日 [自编译引擎验证](patched-engine-validation.md) 完成完整构建和六项协议回归；完整客户端与真实邮箱接入仍待验收。

研究版本、上游 URL 和文件指纹保存在 [source-manifest.json](source-manifest.json)。`Mailspring/`、`Zero/` 是工作区内单独下载的上游资料，不纳入本仓库；本项目尚未成为任何上游的产品分支。视觉参考缓存同样不入库，来源见 [REFERENCES.md](../design/REFERENCES.md)。

## 复现隔离检查

先按 manifest 中的 commit 将 Mailspring 和 Zero 上游源码准备在仓库根目录同名路径下。manifest 记录原研究快照的完整性：Mailspring-Sync 仅取了部分文件，Zero 原快照也不完整；不要把这些研究资料当作可构建的应用。检查脚本当前使用 Mailspring 与 Zero 中选定的 TypeScript 处理器及 stdio bridge，不依赖 C++ 构建。

```sh
npm ci --prefix research/harness
node --test research/harness/check-feasibility.cjs
```

[validation.txt](validation.txt) 保存首次研究的 8 项检查结果；当前脚本补充两项，共 10 项，本轮结果见 [选型验证记录](tech-selection-validation.md)。它们使用隔离的数据库、同步和服务商依赖，以及 loopback 测试服务；没有运行 Electron、编译同步引擎或授权真实邮箱。全新克隆若未准备上游源码，不能直接运行这些检查。

## 界面检查

[收件人、签名与格式工具](controls-validation-2026-11-16/README.md) 继续统一编辑器细节，包含真实窗口前后对照、键盘与格式选区检查，以及补全查询时序回归。

[编辑器与副本辨识](editor-validation-2026-11-16/README.md) 进一步收敛写信／回复布局，并保存副本来源、时间与稳定编号；附设计与真实窗口的前后对照。

`design/preview-checks.js` 用于临时 HTML 中的原型交互检查，不随产品执行。此前 25 项检查与渲染观察见 [UI/UX 评审](../design/UX-REVIEW.md)；这些结果不能代替设计批准、真实用户测试或客户端验收。

[运行界面与设计／spec 的体验走查](ux-audit-2026-11-16/REVIEW.md) 汇总本机测试邮箱下的实际页面截图、四项优先缺口和下一轮验收任务；[交互对照](ux-audit-2026-11-16/index.html) 可直接打开。

[签名管理与表情选择器](settings-validation-2026-11-16/README.md) 记录后续页面打磨和实际键盘／持久化检查。

[Gmail 统一登录与重连](gmail-oauth-validation-2026-11-17/README.md) 将 IMAP 和 HTTPS 发信合为一次 OAuth，复用现有加密凭据与 token 缓存；包含旧账号兼容、取消授权、网络中断和独立应用检查。Microsoft 渠道现已取消，原注册清单已撤下。

当前接入范围已收敛到 Gmail／Google Workspace、iCloud 和普通 IMAP；Microsoft 渠道已取消，不再要求注册项目。最新改动见 [0038](patches/0038-provider-scope.patch)。

[配置完整的 macOS 预览包](distribution-validation-2026-11-17/README.md) 已内置项目 Google Desktop client，使用 Paper Reed 自己的版本和源码标识；公众签名、公证及真实授权验收独立跟进。

[搜索、快捷键与性能审查](search-performance-review-2026-11-17/README.md) 记录非即时搜索复现、1 万／10 万封缓存测量、中文检索和刷新范围问题，以及复用现有引擎与命令体系的改进顺序。

[第一阶段实现](search-performance-review-2026-11-17/IMPLEMENTATION.md) 接通即时搜索与 IME，隔离输入渲染并减少无关刷新；快捷键统一、命令面板和中文子词检索继续按阶段推进。

[工作区快捷键与命令面板](command-panel-validation-2026-11-17/README.md) 接通现有命令体系和轻量面板，附打包应用真实按键测试日志；中文子词检索与大集合查询仍待继续。

[中文片段检索与大邮箱查询](search-scale-validation-2026-11-17/README.md) 接通中文片段和字段限定，优化普通邮箱有序分页，附十万封缓存的结果对照、实际 GUI 与回归日志。

[复杂正文与多账号负载](mail-load-validation-2026-11-17/README.md) 覆盖三个账号、复杂 HTML、长会话、并发查询与本地协议断线恢复；修复待执行搜索在账号切换时丢失的问题，记录启动后长任务的未决边界。

[启动后长任务定位](startup-task-validation-2026-11-17/README.md) 用原始 Chromium Trace 定位延迟模块批量激活，改为逐模块让出事件循环，附前后证据与实际回归结果。

[发布前性能与安全修复](release-fixes-2026-11-17/README.md) 记录 5 项问题的修复、发行包隔离验证、CLI／GUI 截图、跨窗口凭据测试、数据库写锁与进程退出实验，以及 47 个补丁重放结果。
