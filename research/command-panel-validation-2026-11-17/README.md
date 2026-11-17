# 邮件工作区快捷键与命令面板

实现：patch 0041。沿用上游 keymap、CommandRegistry、现有邮件动作和导航方法，没有新的命令服务或状态框架。

## 行为

- 列表的上一封、下一封、选择、取消选择、归档、删除、已读/未读改为响应命令。Gmail、Apple Mail 预设和用户自定义绑定生效，不再用捕获阶段写死 J/K/X/E。
- 邮件工作区的 Cmd+K 打开原生 modal dialog，Cmd+Shift+P 是可自定义的面板命令。正文编辑器保留 Cmd+K 插入链接；Cmd+Shift+P 在编辑器内仍可用。
- Cmd+K 复用 `contenteditable:insert-link` 的上下文行为，因此用户更改该绑定也会改变这个上下文入口。设置里另有独立的 Paper Reed 命令面板与邮件搜索绑定。
- 面板可筛选文件夹跳转、写信、邮件搜索、选中邮件的常用操作、设置和 Agent 交接；不可执行的操作禁用。按钮和面板调用原有工作区方法。
- 输入、↑↓、Enter、Esc 和原生模态焦点范围可用，关闭时恢复此前焦点。只操作本机已聚焦的邮件工作区，不注册系统级热键。
- 邮件搜索继续使用主列表，不把所有设置、邮件和联系人建立成新的搜索数据库。设置独立窗口、系统级唤起和全应用命令覆盖不在此次范围内。

## 真实运行材料

- `check-command-panel.log`：打包应用内真实按键驱动，验证预设切换、自定义绑定、筛选和执行命令、关闭及恢复焦点、编辑器快捷键边界。
- `check-live-search.log`：同一最终包回归即时搜索和刷新行为。
- `commands-typecheck.log`：完整 TypeScript 检查输出。
- `commands-replay.log`：41 个补丁在固定基线上顺序应用，并与实际测试源码逐文件比较。

测试使用一万封 `@example.test` 合成缓存副本，外网由 loopback sandbox 阻断；没有真实发送邮件。自定义快捷键写入的是测试配置，不修改用户配置。邮件操作的服务商协议行为仍由既有收件箱操作测试覆盖，本轮侧重按键、命令与界面的连接。

```sh
AUDIT_PROFILE=research/.local/search-audit/seed-10000 \
sandbox-exec -f research/harness/loopback-only.sb \
node research/harness/check-command-panel.cjs
```

上一阶段的推送为 `3fcde43` 和 `d77a231`。后者保存了输入计数探针的失败日志与收窄断言后的通过日志，详见 `../search-performance-review-2026-11-17/IMPLEMENTATION.md`。
