# 技术选型验证记录

2026-11-15。对应 [选型结论](../design/TECH-CHOICE.md)。这是隔离研究，不是产品集成测试。

## 版本

| 项目 | 已核验版本 | 范围 |
| --- | --- | --- |
| Mailspring | `535f13dd463536f36728bce3efb4ae0d51ab3f19` | 在线默认分支与已有快照一致 |
| Mailspring-Sync | `8681eae1d217d993e4d4dc7de17ae8b91fc3da49` | Mailspring 固定的子模块；本机仅选定文件，不可据此构建 |
| Sync 独立仓库头 | `beea1dba87d8a8cf82e1d34e06e4f19a75df0b50` | 只补查 TaskProcessor；未替换基线或运行该版本 |
| Zero | `36132735ca3b734b23f48127f9271c80d1ba76e7` | 在线默认分支与已有部分快照一致 |

本机 `Mailspring/app/internal_packages/mcp-server/lib/mcp-tools.ts` blob 为 `39eef8b81235334eb39c962fad579faa4684ffdd`，本机 Sync `TaskProcessor.cpp` 为 `bdd1f8ce49d78a08f1a6db9e396ded3e6ef834cc`，均匹配原 manifest。在线 Sync 新头 TaskProcessor blob 为 `e0e462f6eacd102da0aede668ccc6efa40302e29`。

## 可复现检查

准备源码快照的方法与依赖见 [README](README.md)。命令：

```sh
node --test research/harness/check-feasibility.cjs
```

本轮结果：10 tests，10 pass，0 fail。

| 检查 | 观察 |
| --- | --- |
| 上游 stdio bridge | 对本机测试 HTTP 服务转发成功；重新读取已轮换的测试 token |
| 工具注册 | 注册 24 个上游邮件工具 |
| 只读权限 | 草稿、整理、发送在入队前被拒绝 |
| 创建草稿 | 入队并等待本地完成；结果含草稿头标识 |
| 默认账号权限 | 禁用默认账号不能通过省略账号参数持久化草稿 |
| 归档结果 | 返回归档数量时尚未等待远端完成 |
| 发送结果 | 返回 `sent: true` 时尚未等待同步完成 |
| 重复发送调用（新增） | 固定数据库快照下，两次调用产生两个不同任务；不是实际重复投递证明 |
| 草稿修改契约（新增） | 没有 `update_draft`；发送 schema 只有 `headerMessageId`，没有修订号或请求去重输入 |
| Zero 账号切换 | 切换 active connection 后，发送 handler 仍调用初始化时账号的 agent |

处理器使用真实上游 TS，经转译后在 VM 中运行；数据库、任务队列、provider 和部分工厂均为 fixture。stdio bridge 使用真实上游脚本，但连接的是隔离 loopback fixture。**没有连接真实邮箱，没有执行实际 SMTP，没有编译或执行 C++。**

草稿版本写入、发送中断后的状态风险、本机稍后与上游稍后差异，是源码分析，非以上测试覆盖。完整应用的行为需用技术选型文档中的 A–D 实验验证。

原 [validation.txt](validation.txt) 和 manifest 的 8 项结果保留为首次研究记录，不改写历史。本文件记录新增两项及本轮重新执行结果。
