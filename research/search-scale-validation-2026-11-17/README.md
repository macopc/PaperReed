# 中文片段检索与大邮箱查询

对应 patch 0042，基于已推送的 `407434e`。没有改同步引擎或加入搜索服务。

## 实现

- 中文汉字词项按字面片段匹配现有 ThreadSearch 的内容列。`设计` 可匹配 `产品设计`；subject/from/to 限制各自字段。英文词项继续走 FTS，混合查询保留 AND / OR / NOT 结构。
- 使用 `instr` 而非 LIKE，百分号和下划线不会变成通配符；SQL 字符串仍转义单引号。
- 文件夹过滤复用原有名称、角色、账号范围解析，仅将成员测试改为相关 EXISTS。
- 新增一个 SQLite 复合索引：`PaperReedThreadAccountDate(accountId,lastMessageReceivedTimestamp DESC,id ASC)`。首次初始化会创建索引，有一次性构建成本；以后由 SQLite 维护。没有额外内容副本或应用缓存。
- 普通邮箱浏览在同一条 SQL 中分别取得置顶与普通邮件的有序候选，再分页合并。两个分支共享语句快照，避免两次读取之间置顶变化造成重复或遗漏。模型使用既有 Thread 构造函数还原。
- 带关键词的搜索仍使用一次排序查询。试验发现分段方案会重复扫描关键词候选，因此没有把它推广到搜索路径。

中文片段搜索会扫描现有索引内容，不是新的中文分词索引；成本随已缓存正文大小增长。没有下载的正文仍不可搜索。此次不能代表多账号、长 HTML 正文或同步并发的所有性能情况。

## 真实验证材料

- `check-search-scale.log`：打包应用、100,002 个合成会话、两个置顶样本；六种查询 × 五个 offset，与单次排序参考查询比较实际结果 ID，共 30 组。另验证中文命中、subject 限制、NOT、账号授权排除，以及真实 GUI 输入。
- 日志包含四次重复计时。`singleSortMs` 为单次排序参考路径，`orderedRangesMs` 为优化后的入口；后者仅在无搜索词时使用分段，关键词查询主动保留单次查询。参考路径使用当前相同的字段过滤与中文编译器，因此这是排序策略的隔离比较，不是整版客户端的历史横评。
- `check-live-search.log`、`check-command-panel.log`：同一最终包的即时搜索和按键交互回归，均退出 0。
- `typecheck.log`：全项目 TypeScript 检查通过。
- `replay.log`：42 个补丁顺序重放，115 个文件与测试 checkout 一致。
- `initial-result-inflation-failure.log`：第一轮错误地把 JSON 当模型 ID 查找，导致列表空白及等待超时，保留失败过程。最终实现直接用现有 Thread 构造函数还原，后续完整测试通过。

合成夹具已完成 ANALYZE；不连接真实邮箱、不发送邮件。计时包含后台查询通信和模型还原，只是本机样本，不是 P95 承诺。新索引首次构建时间不包含在热查询计时中。

```sh
AUDIT_PROFILE=research/.local/search-audit/seed-100000 \
sandbox-exec -f research/harness/loopback-only.sb \
node research/harness/check-search-scale.cjs
```

后续应以真实正文大小和多账号同步负载评估是否值得扩展中文索引；当前先保留简单、可验证的实现。
