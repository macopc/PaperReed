# 首次打开邮件的 52ms 任务

2026-11-17。先提交推送上一轮 `cd68462`，本轮在此基础上应用 0045。产品改动仅两行：图标目录的递归读取启用 `withFileTypes`，通过目录项的 `parentPath/name` 构造路径。沿用原来的图标映射、共享缓存与首次使用时机；没有新增调度、缓存、锁或依赖。

## 定位

上一轮的 [原始 Trace](../startup-task-validation-2026-11-17/after-trace.json.gz) 中，52ms 是首次打开邮件的渲染线程任务，精确时长 52.861ms。它经过 `FocusedContentStore` 通知、React 首次挂载阅读器和 `RetinaImg → imageNamed → ensureImageCacheReady`。其中同步 `fs.readdirSync` 占 20.2ms；内置图片目录有 4,714 个条目，包含表情资源。该任务中的两次样式更新和一次布局合计约 1.9ms，不支持“主要耗在复杂正文排版”的判断。

未修改代码的重复测量仍有 20.9ms 扫描，但整个任务为 49.655ms。因此超过 50ms 的标签不是稳定复现的开关；目录扫描本身才是可定位、可减少的成本。没有因此改写阅读器或邮件查询。

## 实测

同一台 Mac、打包 Electron 应用、隔离合成账号、loopback-only 网络限制。每次复制全新配置和 SQLite，3 账号 / 30,000 会话，包含复杂 HTML（160 行表格、60,788 字符）、30 封邮件长会话与 18 个并发查询。

| 样本 | 首次阅读器任务 | 其中图标扫描 | 点击至正文可见 |
| --- | ---: | ---: | ---: |
| 上轮原始样本 | 52.861ms | 20.2ms | 119.154ms |
| 修改前复测 | 49.655ms | 20.9ms | 117.895ms |
| 修改后 1 | 43.514ms | 13.1ms | 112.465ms |
| 修改后 2 | 44.668ms | 14.1ms | 114.961ms |
| 修改后 3 | 44.082ms | 13.9ms | 110.888ms |

三次修改后完整负载均通过，观测区间内没有 PerformanceObserver longtask（≥50ms）。这只是本机合成负载结果，不是所有机器、所有邮件都不会卡顿的保证；首次阅读仍有约 44ms 的渲染任务。图标扫描确实减少，但没有消除全部挂载成本。

单独的首次图标读取检查从 16.1ms 降到 10.5ms；与完整负载的耗时不同，不混合比较。`--expect-fast-scan` 是本机 15ms 诊断阈值，保留了 [修改前失败](image-before.log) 与 [修改后通过](image-after.log)，不作为跨机器 CI 门槛。默认检查验证真实首次调用、后续缓存命中、全部 2,590 个 basename 映射、重名覆盖顺序、Retina 选择与缺失图标语义。

## 复现与材料

准备并构建 0045 后，使用已有合成负载配置：

```sh
AUDIT_PROFILE=research/.local/multi-body-load \
  sandbox-exec -f research/harness/loopback-only.sb \
  node research/harness/check-image-cache.cjs

AUDIT_PROFILE=research/.local/multi-body-load \
AUDIT_TRACE_DIR=research/.local/reader-check \
  sandbox-exec -f research/harness/loopback-only.sb \
  node research/harness/check-mail-load.cjs
```

`AUDIT_TRACE_DIR` 可选，仅在检查脚本中开启 Trace 与同步调用探针，输出压缩 Trace、完整结果和阅读器截图；不向产品加入诊断代码。图标扫描的最小检查不加载邮件正文，足以独立重现这一成本；最终仍使用完整负载验证。

- [任务摘要](summary.json)、[含调用栈的 Trace 摘录](trace-excerpt.json)。阅读器任务取包含 `focused-content-store.js` 回调的最长 RunTask。
- [修改前复测](before-repeat.json) / [原始 Trace](before-repeat-trace.json.gz)。上一轮原始 52ms 样本直接链接复用，不重复保存。
- 修改后完整结果：[1](after-1.json)、[2](after-2.json)、[3](after-3.json)；对应原始 Trace：[1](after-1-trace.json.gz)、[2](after-2-trace.json.gz)、[3](after-3-trace.json.gz)。
- [实际阅读器截图](reader.png)：回复图标及正文正常显示。账号同步中断提示来自隔离合成环境。
- [TypeScript 检查](typecheck.log)通过；[45 个补丁重放](replay.log)与 117 个目标文件一致。打包构建完成，版本归属为 `cd68462-dirty`。

截图在首次正文完成及并发查询结束后获取，不计入“点击至正文可见”时间；后续会话步骤的时间间隔因此与早期脚本略有差别。所有完整复测均保留 CPU Profiler / Trace / 同步调用探针，属于带诊断开销的测量。没有测试真实服务商收发，也没有修改代理配置。
