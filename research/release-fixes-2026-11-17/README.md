# 发布前性能与安全修复验证

2026-11-17。补丁 [0047](../patches/0047-release-boundaries.patch)，接在 0046 后，无原生引擎改动。构建基础为 `aa5561c-dirty`，包含本地未提交的 0046 / 0047；精确文件摘要见 [source-manifest.json](source-manifest.json)。

## 修复与证据

| 问题 | 最小改动 | 实际验证 |
| --- | --- | --- |
| P1 凭据并发覆盖 | 主进程中的一个 CredentialStore 负责整份 keyset 的读、改、写与迁移；renderer 只提交字段变更，复用现有 trusted IPC | 同窗口与两个不同窗口并发更新均保留；删除账号与更新交错不恢复旧秘密；失败不覆盖记录、不阻断后续更新；非应用窗口读取被拒绝 |
| P1 本地写入阻塞 UI | 本地 SQL 和批量事务移入现有 database-agent；不增加独立进程池，不再在 renderer 开同步 writer | 持有约 1.8 秒 WAL 写锁时，置顶成功；原定 20ms 的 UI 心跳在 22.5ms 执行，修复前为 1875ms |
| P1 悬空查询 | 移除 async Promise executor；helper close/error 结束属于它的在途请求；不静默退回 UI 执行 | 注入查询错误后正常 rejected，没有 unhandled rejection；暂停并终止实际 helper 后旧查询 rejected，下一次查询由新 helper 成功返回 |
| P2 远程图片阻断绕过 | EmailFrame 在解析邮件前设置 CSP；以用户允许状态作为 iframe key；去掉正则正文改写和 CSS 解析失败返回原文的兜底 | 实际组件对 img、srcset、CSS shorthand、stylesheet、字体均无远程请求；data 内嵌图片正常；显式允许后请求到达；再次阻断后无请求；脚本未执行 |
| P2 Agent 资源边界 | MCP SDK 1.32.0、Zod 4.6.7；新会话与已建立会话均限制 2 MiB 请求，工具参数限制 10000 个集合元素；DOMPurify 更新至 3.4.17 | 5 MiB 请求和 chunked 请求返回 413；已建立会话同样受限；超集合上限被拒绝，随后普通请求成功；错误 token 401、错误 Host 403 |

[完整运行日志](boundaries.log)、[结构化结果](boundaries-result.json)、[修复前证据摘要](before-result.json)。均来自实际构建的应用，不是手工填入的预期结果。

性能测量代表这个确定的争用场景，不代表 Gmail 每次同步都持有长事务，也不代表所有操作都有同样幅度的提升。置顶仍等待数据库释放写锁，修复的是等待期间 UI 被冻住。

## 回归

- CLI 经实际 MCP 接口验证置顶、取消置顶、稍后、取消稍后、标签创建／改名／关联／删除，以及 GUI 自动反映 CLI 修改。
- 规则保存、预览、应用、重排、过期修订拒绝；通过合成邮箱的新 UID 情景验证自动分类；手动分类优先级保留。
- 删除标签与暂停依赖规则在同一事务；使用第二条故意无效的 SQL 验证前一条写入回滚；撤销权限后新写命令被拒绝。
- [3 个账号、3 万封缓存邮件负载](mail-load.log)：账号与文件夹范围、搜索期间切换账号、分页、并发查询、权限排除、复杂 HTML 表格及 30 封会话通过。
- [快捷键与命令面板](command-panel.log)：返回列表焦点、快捷键方案、自定义绑定、搜索输入保护通过。
- [凭据规格测试](key-manager-spec.log) 19 项通过，覆盖旧加密格式迁移、密钥不可用、损坏内容及错误处理；[资源策略规格测试](image-policy-spec.log)通过。
- [TypeScript](typecheck.log)、[macOS 构建](build.log)通过；[47 个补丁重放](replay.log)与 126 个涉及文件一致，CLI 源码副本一致。

实际运行截图：[CLI 创建并关联的标签出现在 GUI](cli-label-in-gui.png)。画面是合成的 `@example.test` 邮箱；同步中断提示来自隔离环境，不能把它当成真实服务商在线验证。

## 范围与复杂度

- 草稿版本检查、发送幂等、权限检查及附件所有权约束保持原样；没有增加通用重试框架、全局邮件锁或自动重发。
- 凭据队列只保护一份共享 keyset，失败传给原调用者后继续下一项。读取也走同一个拥有者，迁移写入不会绕过队列。
- 本地事务在提交前检查权限；已经提交的事务可以完成，权限撤销阻止后续提交。读取结果在 helper 返回后重新检查权限。helper 失败明确返回错误，不重放在途写入。
- 原生邮件同步、发送逻辑没有修改；本轮没有发送真实邮件、修改代理或使用真实秘密。凭据探针替换的是加密适配器，实际业务方法、主进程队列、IPC 与窗口权限检查均运行；没有以假加密替换生产实现。
- runtime 探针使用临时复制的数据库和 loopback-only OS 沙箱。`--no-sandbox` 仅用于该外层沙箱下的自动化 Electron 进程，不写进产品发行配置。

## 依赖与复现

锁文件除本轮主动更新的 3 个直接依赖，还补录此前本地安装已经存在的 6 项版本差异：editions/semver、make-dir/semver、顶层 semver、juice/undici、顶层 undici、strip-ansi/ansi-regex。这样干净准备的源码锁文件与实际验证环境一致，没有执行 `audit fix --force`。

[本轮依赖扫描](npm-audit-after.json)中 MCP SDK、Zod、DOMPurify 已不再标记上述告警。扫描仍列出 19 个依赖／传播条目（并非 19 个已验证的客户端漏洞），没有将整个依赖树宣称为安全清零。新增显示的 fdir、picomatch、tinyglobby、sucrase 四个条目来自同一个 picomatch ReDoS 公告；当前应用调用 sucrase 的位置是 Views 的 transform，没有发现邮件内容进入 glob 参数的路径。参见 [依赖链](dependency-paths.txt)。其他上游传递依赖风险延续前次审查结论，本轮未进行全量可利用性验证。

从仓库根目录运行（先准备合成 fixture 和构建）：

```sh
python3 scripts/build-desktop.py --google-client research/.local/paper-reed-google-client.json --skip-archive
AUDIT_PROFILE=research/.local/multi-body-load sandbox-exec -f research/harness/loopback-only.sb node research/harness/check-release-boundaries.cjs
AUDIT_PROFILE=research/.local/multi-body-load sandbox-exec -f research/harness/loopback-only.sb node research/harness/check-mail-load.cjs
AUDIT_PROFILE=research/.local/multi-body-load sandbox-exec -f research/harness/loopback-only.sb node research/harness/check-command-panel.cjs
```

凭据与资源策略规格测试使用开发 checkout 的 `scripts/test.js --test --no-sandbox`，分别选择 `key-manager-spec` 和 `autoload-images-extension-spec`，并设置绝对路径的独立 config 目录。

本轮没有设置 0.0.1、制作 Logo、签名、公证或发布。确认的五项修复完成后，可以回到首个测试版包装步骤；当前已运行的旧客户端进程需要重启才会加载新代码。
