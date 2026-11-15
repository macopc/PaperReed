# 页面入口

当前：第八版「纸白与苇绿」及后续打磨，暂作首版界面基线。所有页面仍使用示例数据，不代表真实邮箱能力已经实现。

[交互总览](direction.html)：底部可切换多个页面，页面之间共享示例状态。

| 页面 | 独立入口 |
| --- | --- |
| 收件箱 | [inbox.html](pages/inbox.html) |
| 会话与回复 | [thread.html](pages/thread.html) |
| 写邮件 | [compose.html](pages/compose.html) |
| 搜索 | [search.html](pages/search.html) |
| 稍后处理 | [snooze.html](pages/snooze.html) |
| 邮箱设置 | [accounts.html](pages/accounts.html) |
| 外部 Agent | [agents.html](pages/agents.html) |

独立打开会恢复各自的初始示例数据。在交互总览中测试跨页面流程，可保留当前会话中的草稿与筛选状态。

[设计规格](INTERFACE.md) · [上一版](direction-v7.html) · [架构候选（未定稿）](ARCHITECTURE.md)

新增目的地与整理页面：

- [草稿](pages/drafts.html)
- [已发送](pages/sent.html)
- [垃圾邮件](pages/spam.html)
- [废纸篓](pages/trash.html)
- [标签与自动分类规则](pages/organize.html)

[UI/UX 评审与修改依据](UX-REVIEW.md)
