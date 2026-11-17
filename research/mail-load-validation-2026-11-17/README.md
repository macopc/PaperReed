# 复杂正文与多账号负载验证

基于已推送的 `d1dd41b`，验证打包应用与既有本地协议夹具。发现并以 patch 0043 修复一处搜索/账号切换交接问题，没有增加缓存、线程或服务。

## 数据与方法

- 3 个独立 `@example.test` IMAP 账号，共 30,000 个会话、30,087 封邮件。
- 600 个 HTML 会话，包括中英混排、160 行表格、嵌套引用；其中三个往来会话各有 30 封 HTML 邮件。
- 缓存正文合计 50,653,689 字节；SQLite 文件约 202MB。字段、正文和 FTS 内容由同一生成器构造，执行 ANALYZE 后测试。
- 每个账号包含收件箱、稀疏归档、空垃圾邮件文件夹、置顶和未来稍后处理样本。专属中文标记用于检查范围混淆。
- 打包应用复制独立配置和数据库，loopback sandbox 阻断外网。所有数字来自合成缓存，不是实际 Gmail / iCloud / 企业邮箱规模或网络性能。

`seed-mail-load.py` 构建数据；`check-mail-load.cjs` 通过真实应用的查询服务、Playwright 按键/控件和 CDP 观察正文、性能指标。

## 已通过

1. 统一收件箱和单账号查询范围；其他账号的专属标记不会泄露。
2. 收件箱、稀疏归档、空文件夹与单次排序参考查询一致；跨页没有重复，置顶在前。
3. 三账号并发请求结果各归其账号；账号授权与排除文件夹仍生效。
4. 真实 GUI 中切换账号后，旧搜索结果不覆盖新账号；修复后未执行的输入也能保留。
5. 阅读窗口 iframe 实际渲染出正文末尾标记与 160 个表格行，不只等待邮件外壳。
6. 30 封往来会话全部加载，缓存 HTML 正文可读。默认折叠行为保留，未强制展开全部 30 封。
7. 18 个中文搜索请求并发期间，仍能打开 HTML 正文；并发结果再次检查账号归属。
8. 现有双账号本地 IMAP/SMTP 协议测试通过：断线仅影响对应账号、其他账号仍可写草稿、离线草稿可重启恢复、重连不自动发送。唯一 SMTP 提交为脚本明确提交至本机假服务器的测试信，没有真实邮件发送。

## 发现与最小修复

输入搜索词后，若在 180ms 自动触发前切换账号，搜索框因 key 改变而重建，旧输入计时器被清理，查询词丢失。`initial-account-switch-failure.log` 保留首次失败。

patch 0043 只在搜索框失焦且有待执行输入时提交已有搜索。仍由原来的 composition 判断、generation 和账号切换逻辑处理查询，不引入新的状态同步机制。复测模拟输入框失焦，再改变原生账号选择控件。

## 实测限制与待查项

`load-test.log` 保存查询阶段、GUI 阶段和 HTML 打开阶段的时间标记，以及全部查询样本、iframe 行数、长任务和 renderer CPU 样本摘要。最终运行启用了 CPU 采样，不能将其当作无仪器开销的性能承诺。

复杂 HTML 打开到末尾标记约 134ms，30 封会话加载到可见正文约 63ms；18 个并发请求整体完成约 592ms。这些是单次场景测量，不是 P95。

两次运行均在启动后的查询阶段观察到一次长任务（约 102ms / 116ms），早于 HTML 打开。CPU 摘要不足以把它唯一归因于 SQL、同步事件或 IPC，因此仍列为开放项；不能宣称整体卡顿已全部消除。后续若继续优化，应先对这一时间段做更细的 tracing。

末尾 renderer JS heap 约 75MB，仅表示该 renderer 的 JavaScript 堆，不是应用总内存，也不证明长时间运行没有泄漏。此次未覆盖持续数小时同步、真实远程图片/附件下载、巨型正文、全部邮件同时展开或多家真实服务商并发网络连接。

## 真实材料

- `fixture.json`：账号、会话、正文大小与复杂正文数量。
- `load-test.log`：最终打包应用的完整结果；`load-first-pass.log` 为未启用 CPU 采样的前一轮结果。
- `initial-account-switch-failure.log`：发现问题时的原始输出。
- `protocol.log`、`protocol/result.json`：既有双账号原生协议测试输出。此测试运行当前源码的开发应用，不冒充打包应用的网络验证。
- `check-live-search.log`、`check-command-panel.log`：最终包交互回归。
- `typecheck.log`、`replay.log`：完整类型检查和 43 个补丁/115 个文件重放结果。

```sh
python3 research/harness/seed-mail-load.py \
  --base research/.local/first-run-penrx19w/profile \
  --output research/.local/multi-body-load

AUDIT_PROFILE=research/.local/multi-body-load \
sandbox-exec -f research/harness/loopback-only.sb \
node research/harness/check-mail-load.cjs
```

生成器输出目录必须不存在；base 为此前本机原生测试生成的合成配置。默认每账号 10,000 个会话与 GUI 测试中的固定样本配套。
