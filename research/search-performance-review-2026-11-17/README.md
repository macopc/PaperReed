# 搜索、快捷键与响应速度审查

日期：2026-11-17。状态：诊断与建议，尚未实施产品修改。

本轮针对“搜索需要提交、希望有全局搜索和应用内快捷键、整体感觉慢”。检查当前配置完整的 macOS 预览包和对应源代码。沿用当前 Mailspring / SQLite 架构，先修可以复现的问题。

## 结论

- 非即时搜索已复现：输入后等 600ms，旧列表仍在；Enter 后查询才运行。
- 搜索基础可以复用：GUI / CLI 已共用 `queryInbox`，搜索走现有解析器、SQLite FTS5 和后台数据库查询。缺口主要在新界面的交互接入，以及中文子词检索。
- 快捷键设置已有预设与自定义，但 Paper Reed 列表用 capture 阶段的 `keydown` 写死了 J/K/X/E 和 Cmd+F，没有统一经过已有命令映射。
- 可以确认不必要的整页刷新、输入重渲染和大集合排序。不能据此宣称已找到用户“整体慢”的唯一原因：本轮没有测真实同步、多账号负载、复杂正文或持续运行后的资源占用。
- 暂无证据需要更换 Electron、另建搜索服务、加入向量数据库或搭第二套索引。

## 测量方法与边界

- 使用打包后的 `Paper Reed.app`，版本 `0.1.0-preview.1`；对应主仓库 `05474a4f` 及未提交的发行配置 patch 0039。
- Playwright 启动独立配置目录，通过 CDP 观察真实主窗口。最初选中隐藏后台窗口的两次失败属于测试脚本问题，未计入数据。
- 只复制 `@example.test` 合成账号的缓存，并构造 10,000 / 100,000 封单邮件会话，另保留基础夹具的 2 个会话。正文都是短文本，FTS 预先填充。
- 用 `sandbox-exec -f research/harness/loopback-only.sb` 限制外网，不连接真实邮箱、不发送邮件、不修改代理。
- 数据库副本包含已缓存正文；不代表初次同步、下载附件、真实邮箱分布或长会话。
- 计时包括自动化交互和 DOM 就绪等待；启动指进程启动至首行可见，不是机器冷启动。打开邮件只测到消息区域出现，不代表复杂 iframe 所有内容与远程图片加载完毕。
- 试验脚本及配置副本位于忽略目录 `research/.local/search-audit/`。它们是本机诊断工具，不属于发行代码或稳定 CI 接口。版本化的 `measurements.json` 只保留合成数据指标。

### 已执行的失败检查

```sh
AUDIT_PROFILE=research/.local/search-audit/seed-10000 \
AUDIT_RESULT=large-detail.json \
sandbox-exec -f research/harness/loopback-only.sb \
node research/.local/search-audit/profile.cjs --expect-live
```

输出：输入后 600ms 仍有 50 行旧结果，`liveSearch: false`；断言 `Search results do not update after typing without Enter`，退出码 1。它通过真实搜索框驱动，后续即时搜索实现应使该条件通过。其他诊断探针观察当前缺口，不是现有产品已经通过的验收用例。

### 测量摘要

一万封重复运行：启动至首行约 0.72–0.75s；返回收件箱约 55–70ms；打开短文本邮件约 91–109ms；宽泛 `project` 搜索约 43–92ms。

十万封两次测量：启动至首行约 0.84–0.93s；返回收件箱约 212–214ms；打开短文本邮件约 82–85ms；宽泛 `project` 搜索约 183–536ms，`subject:note` 约 299–384ms。样本较少且有波动，不能称为 p95 或性能承诺。复测交互阶段没有观察到 >50ms 的 renderer long task，最长数据库调用约 377ms；这更像等待查询结果，而不是这一段主线程一直冻结。

零结果查询很快，不能用来代表常见词命中大量邮件的搜索成本。索引已就绪、正文已缓存时，短邮件阅读本身没有表现出明显的普遍卡顿。

## 具体发现

### 1. 输入和查询断开，且缺少建议

`app/internal_packages/paper-reed/lib/workspace.tsx` 的 `onChange` 只设置工作区 `searchText`，表单提交才调用 `search()`。不存在输入延迟触发、联系人建议、条件补全或全局入口。

上游 `thread-search/lib/thread-search-bar.tsx` 已有联系人、主题和条件建议；`search-bar-util.ts` 提供 `getThreadSuggestions`、`getContactSuggestions`、`getCategorySuggestions`。优先复用数据查询和语法，按 Paper Reed 的布局重新呈现，不直接搬回旧搜索控件。

### 2. 输入和后台更新扩大了渲染范围

`workspace.tsx`：

- 搜索文字属于整个工作区的 state。输入 `project` 的 7 次按键产生至少 7 次工作区 render，列表也跟着重新生成；额外 render 可能来自轮询。
- 无条件 `DatabaseStore.listen(this.scheduleRefresh)`。注入一个不含邮件变化的 Contact change record，仍触发 3 次 DatabaseStore 查询和 1 次工作区 render，另有本地标签读查询未包含在该计数中。
- `refreshOperations` 每 2 秒查询最近发送记录，记录没变也重新 `setState`。4.2 秒空闲窗口内观察到 2 次发送记录查询；整个窗口有 5–6 次 render，其中还包含其他启动/状态事件，不能全部归因于轮询。
- `FolderSyncProgressStore` 和 `DraftStore` 的监听直接 `forceUpdate`；没有证据证明每次都产生可感知卡顿，但更新范围过大。
- `scheduleRefresh` 每次重新开始 100ms 计时。连续事件是否导致列表迟迟不更新，仍需同步负载验证。

先收窄事件类型和受影响账号，将输入状态放回搜索组件、发送状态更新限制在对应区域；保留现有跨 CLI / GUI 发现发送结果的能力。不要为了消除两秒轮询再新建一套事件总线。

### 3. 数据库查询有规模成本，不能只怪置顶排序

`services/mail-core/inbox.ts` / `mail-access/queries.ts` 生成的列表 SQL：文件夹成员集合 → Thread → 稍后过滤 → 置顶、日期排序 → LIMIT。实测 SQL 计划使用临时 B-tree 排序，展示 50 行不等于只检查 50 个候选。

对相同合成缓存做 Python SQLite 只读查询诊断：10 万封查询中位数约 154ms。仅移除置顶排序表达式仍约 147ms，仍然需要临时排序。这个隔离实验不能当作修复方案，说明“删除置顶逻辑就能解决”不成立。Python 与打包程序的 SQLite 版本及连接环境不同，绝对耗时不可直接对比。

优先检查候选集合、排序与现有 `ThreadListCategoryIndex` / `ThreadDateIndex` 的使用方式，再以同样结果集验证 SQL 调整。不要先添加一堆索引或跨层缓存。主搜索已在后台查询，不需要再套一层 worker；本地同步 SQL 在本次小批读取中耗时很低，尚不能认定它是主因。

### 4. 中文搜索与范围表达不完整

- 现有索引使用 `porter unicode61`。合成正文包含“产品设计”，查询完整词有结果，查询“设计”没有结果，已从 GUI 复现。中文子词/分词能力要单独验证，不能把“接入 FTS”当成中文搜索验收通过。
- GUI 展示“本机已同步邮件”，需要继续明确：正文尚未缓存/索引的邮件，不能保证按正文找得到。
- 输入查询后不再沿用当前文件夹过滤，只保留账号范围和未读状态；应在输入框附近清楚表达“全部邮箱 / 当前账号 / 当前文件夹”。
- Paper Reed 自定义标签与置顶/稍后状态属于本地表，现有上游 `in:` / `is:starred` 不能直接等同于这些状态。筛选条要调用现有本地过滤能力，扩展 CLI 语法时保持同义，不建立另一套筛选解释。
- GUI 最多显示 100 个会话。虽然有明确提示，搜索与日常列表仍会碰到人工上限。后续做正常分页，再按渲染证据决定是否需要虚拟列表。

### 5. 快捷键缺统一的上下文

`preferences-keymaps.tsx` 已支持预设和编辑；`workspace.tsx` 列表捕获阶段提前处理写死的按键。设置成 Apple Mail 后，列表 J 仍然能移动焦点，而该预设下一项使用方向键。现有 Cmd+F 能聚焦列表搜索，不能据此认为所有页面快捷键均已统一。

首版应接回已有命令/按键系统，让菜单、快捷键帮助、面板和按钮调用同一动作。列表、阅读、编辑器按焦点分域；输入中文和编辑正文时不捕获单字母操作。

特别注意：当前编辑器 `Cmd+K` 是插入链接。命令面板不能直接全局截获这个按键；编辑器保留链接动作，提供可见的面板入口及 `Cmd+Shift+P` 备用入口。

## 官方竞品参考

| 产品 | 有依据的行为 | Paper Reed 可以借鉴 |
| --- | --- | --- |
| [Apple Mail](https://support.apple.com/en-bn/guide/mail/mlhlp1003/mac) | 官方搜索摘要描述输入时出现搜索建议；正文抓取遇到 429，因此不据此推断所有完整结果都即时刷新 | 输入时给出有用反馈与建议，搜索条件可选择 |
| [Spark 搜索](https://sparkmailapp.com/help/manage-your-inbox/use-smart-search) | Mac 官方步骤仍是输入后按 Enter；支持发送人、日期、附件等条件和账号范围选择 | 不能简单说“现在没有产品按 Enter”；需要解决的是反馈、建议和多余操作 |
| [Spark Command Center](https://sparkmailapp.com/help/general/spark-command-center) / [Superhuman Command](https://new.superhuman.com/superhuman-command-29123) | Cmd+K 提供可搜索动作；Superhuman 显示每个动作的快捷键并支持邮件操作和页面跳转 | 一个克制的跨页面入口，帮助用户逐渐学会快捷键 |
| [Mailspring 搜索](https://www.getmailspring.com/docs/search-with-advanced-gmail-style-queries) / [快捷键](https://www.getmailspring.com/docs/learn-and-customize-keyboard-shortcuts) | 本地邮件索引、结构化搜索、缓存范围限制，以及预设/自定义快捷键 | 复用现有引擎和命令体系，补上 Paper Reed 新页面缺失的接线 |

上述是公开官方文档与本机源代码比较，不是对所有竞品客户端的实机性能横评。

## 建议的最小产品方案

**邮件搜索**：输入约 150–200ms 后自动查本地结果，中文组词完成后再触发；Enter 可立即执行。查询时保留已有列表并显示轻量状态；旧结果不能冒充新结果，异步旧请求也不能覆盖新请求。复用已有 generation 判断，不增加一套取消/锁机制。范围选择和条件建议比“大搜索按钮”更有用。

**全局入口**：Cmd+K 打开轻量面板，首版只覆盖搜索邮件、跳转文件夹/账号、常用邮件动作、设置及 Agent 交接。邮件用现有索引，动作/页面用小型静态列表；面板统一入口即可，不需要把设置、联系人和邮件重建成统一搜索数据库。通讯对象补全复用 ContactStore，邮件搜索结果继续在主列表呈现。

**快捷键**：应用聚焦时生效，沿用已有自定义机制。建议 Cmd+N 写信、Cmd+F 按阅读/列表上下文查找、Cmd+Option+F 跨邮箱找邮件、Cmd+K / Cmd+Shift+P 打开面板、Esc 返回或关闭；列表支持方向键和可选 Gmail 单字母习惯。具体组合需要与现有预设对照，不能无条件覆盖。当前不需要注册系统级全局热键。

**性能**：先减少无关事件查询和不变数据 render，缩小输入更新范围；然后优化大量候选时的查询排序。保留离线先显示缓存的行为。复杂正文、规则运行、同步并发、启动模块与进程资源在真实负载采样后再决定是否调整。

## 实施顺序与验收

1. **即时搜索与工作区刷新范围**：真实输入测试从红变绿；中文组词不被打断；连续输入只展示最后一次查询；同账号无关 Contact 事件不重查列表；CLI 更改后 GUI 仍能刷新。
2. **统一快捷键与轻量命令面板**：修改预设/绑定能改变当前列表行为；写信和输入框不误触邮件操作；Cmd+K 不破坏编辑器链接功能；按钮、快捷键、面板走相同动作。
3. **大邮箱查询与中文检索专项**：扩展 1 万 / 10 万封夹具，含多账号、长会话、常见词、稀有词和中英混排；比较结果正确性和响应耗时。中文后缀/子词测试不能只用完整词蒙混通过。
4. **真实负载采样**：对用户所运行的同一版本记录启动、同步中切换、长正文、设置导航、写信输入、内存与 CPU；只记录耗时和数量，不记录邮件内容。对“整体慢”保留这个开放项。

初步体验预算（目标而非本轮承诺）：缓存页面切换 P95 <100ms；本地搜索输入停止后约 250ms 内出现结果；可交互阶段避免 >50ms 主线程长任务。需要足够次数和代表性数据后才能用 P95 判断。

[Electron 官方性能指南](https://www.electronjs.org/docs/latest/tutorial/performance) 同样建议先测量、定位高成本路径，再针对性优化。本轮不改变技术栈，不引入搜索服务或通用缓存框架。
