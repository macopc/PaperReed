# 源码研究

状态：可行性探索，不代表已最终选定产品底座或完成生产验证。

最新进展：[首版技术选型](../design/TECH-CHOICE.md) 与 [本轮验证记录](tech-selection-validation.md)。当前推荐优先验证 Mailspring 产品分支；尚未通过完整构建与真实邮箱实验。

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

`design/preview-checks.js` 用于临时 HTML 中的原型交互检查，不随产品执行。此前 25 项检查与渲染观察见 [UI/UX 评审](../design/UX-REVIEW.md)；这些结果不能代替设计批准、真实用户测试或客户端验收。
