# 第一阶段：即时搜索与刷新范围

对应 patch 0040。先前的发行配置和审查已提交推送至 `3be298e`。

## 已实现

- 搜索框独立维护输入，停止输入 180ms 后运行现有 `queryInbox`，Enter 可立即执行，清除恢复当前列表。
- 中文 IME composition 期间不查，组词结束后查。组件卸载时取消待执行的输入计时器。
- 输入期间与查询期间分别提示状态；查询时保留上次列表并标记 `aria-busy`。沿用 generation 避免旧查询晚返回覆盖新结果。
- 数据库记录只在涉及当前账号的 Thread / Message / Folder / Label 时触发列表刷新；保留本地标签和账号等已有监听。
- 保留发送记录轮询来发现 CLI 产生的结果，但内容未变化时不更新 React state。

没有新增索引、服务、缓存框架或锁。尚未实施第二阶段快捷键/命令面板，以及第三阶段中文子词检索和大集合 SQL 优化；本文不宣称解决了所有“整体慢”的情况。

## 验证

全项目 TypeScript 检查通过。40 个补丁可在固定基线上顺序重放，110 个源文件与测试 checkout 一致。

新增 `research/harness/check-live-search.cjs`，针对打包应用、独立的合成缓存副本测试：

```sh
AUDIT_PROFILE=research/.local/search-audit/seed-10000 \
sandbox-exec -f research/harness/loopback-only.sb \
node research/harness/check-live-search.cjs
```

夹具来自本轮审查的一万封合成缓存；脚本拒绝非 `@example.test` 账号。没有发送邮件或改动真实账号。

已通过：自动搜索、清除、中文组词、输入不触发工作区 render、无关数据库记录不触发查询、发送结果未变化不重绘、慢查询保留旧列表、迟到查询不覆盖新结果，以及相关邮件记录继续刷新。慢查询使用仅测试进程内的后台查询延迟模拟，测试关闭应用后 instrumentation 不留在产品内。

审查阶段的即时搜索检查此前失败；本次相同真实搜索框路径已通过。这里验证了交互和刷新行为，不将合成短正文结果外推成真实同步时的性能承诺。
