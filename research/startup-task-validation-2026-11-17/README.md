# 启动后长任务定位与修复

上一阶段已提交推送 `9741ea0`。本轮 patch 0044 只调整延迟模块激活的调度，没有新增缓存、线程、锁或重试。

## 根因与证据

三账号负载测试可稳定观察到启动后一次超过 80ms 的 renderer task。最初总 CPU 样本无法准确归因；本轮对同一路径开启 Chromium Tracing，并记录同步 IPC、同步文件调用、数据库本地执行和逐模块激活时间。

Trace 将长任务定位到 `src/package-manager.js` 的定时器回调，对应源码 `app/src/package-manager.ts` 的 `activatePackages`：启动 800ms 后，在一个回调中循环激活整个 waiting 队列。

复测中，该回调激活 41 个模块，持续 128.711ms。逐模块累积约 128.6ms，最长的 unsubscribe 模块约 40.7ms；其次为 mcp-server 和 views。同一时间段没有观察到大于 5ms 的已探测同步 IPC、文件或本地数据库调用。这里的根因是模块激活在单个任务内累积，不是中文搜索 SQL 或 HTML 正文渲染。

`before.log` 的 `--expect-responsive` 检查以退出码 1 结束；`before-trace.json.gz` 保存原始追踪，`trace-excerpt.json` 保留相关 FunctionCall 的来源、时间和持续时长。探针只安装在独立测试进程内，产品代码不保留探针。

## 最小修改

原来的 800ms 延迟保留。waiting 队列改为按顺序激活一个模块，再用零延迟定时器安排下一个，让输入、绘制和其他任务有机会执行。`syncInit` 分支仍立即执行；模块激活函数、错误处理、禁用规则和窗口范围判断不变。

44 个补丁可重放；全项目类型检查通过。新增 `check-package-activation.cjs` 用真实 PackageManager 方法验证：同步模块立即激活、其他窗口的模块不激活、延迟模块顺序保持、两个延迟模块之间确实有事件循环机会。最后一项是行为断言，不依赖机器速度；`--expect-responsive` 的 80ms 检查只作为这套本机夹具的诊断阈值。

## 修复后的观察

同一负载、相同 tracing 探针下，最长模块激活回调为 36.589ms。41 个模块依旧按顺序完成，模块耗时合计约 119.9ms，整个延迟激活跨度约 284.2ms。

这次改动缩短连续阻塞，代价是延迟模块全部完成稍晚。没有宣称启动总耗时或加载工作量减少。数值来自单次追踪，不是 P95，也不能外推至所有机器或第三方插件。

原先的批量长任务不再出现。完整负载仍观察到另一次约 52ms 任务；它不是原来的批量激活回调，不据此声称所有长任务均消失。以后若出现单个模块长期超过预算，需要针对该模块另行分析，而不是继续叠加调度机制。

## 实际验证材料

- `before.json` / `after.json`：完整负载结果、阶段标记和每个模块激活耗时。
- `before.log` / `after.log`：修复前失败与修复后通过的同一路径输出。
- `before-trace.json.gz` / `after-trace.json.gz`：Chromium 原始 Trace，可解压导入 DevTools Performance。
- `trace-excerpt.json`：可直接阅读的激活回调证据；`activation-chart.html` 为对应图表。
- `activation.log`：最小化启动检查，包含真实模块顺序和事件循环交接断言。
- `check-live-search.log` / `check-command-panel.log`：最终打包应用交互回归。
- `protocol.log` / `protocol/result.json`：当前源码的本地双账号 IMAP/SMTP 验证，包含 MCP/CLI 接入、离线草稿、重连和明确提交后单次发送。网络只允许 loopback，没有发送真实邮件。
- `typecheck.log` / `replay.log`：类型检查、44 补丁与 116 源文件一致性。

```sh
AUDIT_PROFILE=research/.local/multi-body-load \
sandbox-exec -f research/harness/loopback-only.sb \
node research/harness/check-package-activation.cjs --expect-responsive
```

详细 tracing 用的临时探针脚本保留在忽略目录 `research/.local/long-task/trace.cjs`；稳定回归以仓库内的最小化启动检查为准。夹具为前一轮生成的三账号合成缓存。
