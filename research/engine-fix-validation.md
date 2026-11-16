# 邮件核心修复实验

2026-11-15。上一轮失败复现已提交推送为 `1257d2e`。这轮实际修改了固定上游源码，交付 [两份可应用补丁](patches/README.md) 和回归检查，没有改产品设计页面。

**2026-11-16 更新：完整修改版引擎已构建成功，六项协议回归通过，见 [自编译引擎验证](patched-engine-validation.md)。** 下文保留 11 月 15 日的局部检查记录；Mailspring 复用路线仍未通过完整产品验收。

## 修正内容

### 草稿保存与界面编辑

- 原 `performLocalSaveDraft` 事务内按账号、Message-ID 查找草稿，比较调用者的 `v` 与当前版本。旧版本、错误本地 ID、缺少修订或账号不匹配均拒绝；省略本地 ID 也不能绕过检查。版本仍使用现有模型的单调值，不假定每次只增加 1。
- 发送占用的草稿拒绝继续保存或删除。新草稿本地 ID 由引擎生成。
- 保存结果携带实际写入后的版本和 ID。编辑器有未保存修改时不采纳外部版本号，否则“保留旧正文、采纳新版本”仍会绕过冲突保护。
- 编辑器检查保存回执中的错误；保存失败不推进已保存时间、不清空脏状态；发送流程停止并保留编辑会话。保存途中继续输入的内容仍标记为未保存。

### 发送受理与恢复

- 同一 SQLite `BEGIN IMMEDIATE` 事务写入发送记录与 `remote` 状态的原任务，避免崩溃后启动清理把受理中的 `local` 任务删掉。发送记录独立于仅保留最近约 100 条的 Task 历史。
- 发送记录使用 `(accountId, requestId)` 主键，当前 requestId 取原 task id；活动草稿使用 `(accountId, Message-ID)` 唯一约束。不同任务不能同时发送同一草稿。相同 task id 已存在时保留原任务，不覆盖它。
- 持久记录发送快照，远端阶段从记录读取；调用者携带的 `_performRemoteRan`、`sendOutcome`、`sentCopy` 不作为执行依据。
- 阶段为 `queued → attempting → accepted`。在网络提交前持久化 `attempting`；SMTP / Graph 接受后尽早持久化 `accepted`。恢复时 `attempting → unknown`，不重投；无发送记录的旧版遗留任务同样按不确定处理。
- 网络提交前的失败与排队阶段取消记为 `rejected`，释放草稿占用，但保留该请求历史。进入网络提交后不能可靠判断是否接受的异常统一为 `unknown`，继续占用草稿。这里采取保守处理，可能把明确拒绝的网络错误也归为不确定。
- 服务端接受和已发送副本分别存储。副本暂未找到、写入失败或后续清理异常，不把发送变回可重试的失败。界面只在 `sendOutcome=accepted` 时触发成功；副本异常单独提示。

这轮仅支持一次提交一份 MIME。上游跟踪功能的“各收件人不同正文”在提交前拒绝，避免不完整地处理部分成功；首版不需要该功能。

## 实际执行的验证

| 检查 | 结果与范围 |
| --- | --- |
| 新协议回归断言对旧预编译引擎 | `--expect-fixed --case stale-draft` 按预期失败：引擎接受旧稿，没有 `draft-conflict`。这确认断言能够抓住已复现缺口，不是修复通过 |
| C++ 事务测试 | 编译**补丁中实际的 guard 头文件**、固定上游 SQLiteCpp 及其自带 sqlite3.c 后执行；5 组输出通过，覆盖旧版本/省略 ID/错误账号、原子回滚、重复请求/修改载荷、不同请求争抢草稿、任务清理、账号隔离、提交前失败后重试、SIGKILL/重启、不确定状态锁定、接受与副本失败分离、两个进程并发竞争 |
| C++ 接入文件语法 | `TaskProcessor.cpp`、`MailStore.cpp` 通过 `clang++ -fsyntax-only`。借用源码头文件和 libetpan 已提交配置头的非 Windows 分支，**不等于真实 macOS 配置、ABI、链接或完整编译通过** |
| TypeScript 行为边界 | 运行实际修改后的 TS 方法，窄适配器模拟 TaskQueue / 数据库 / AppEnv：保存失败保留编辑、保存途中新输入仍脏、失败/取消回执拒绝、unknown 不触发成功、副本失败不重报投递失败、编辑器不隐式换基线、成功回执推进版本；3 组输出通过 |
| 完整上游 TS 类型检查 | 修改后的 checkout 执行 `npm run typecheck`，退出 0 |
| 补丁可应用性 | 两份补丁均可应用到记录的固定源码；应用后的文件与上述检查使用文件逐字节一致 |

C++ 事务测试确实杀死一个写完阶段记录的子进程，但没有启动 IMAP/SMTP 引擎。TS 方法测试使用适配器，不是完整 GUI。没有用旧二进制冒充补丁构建产物，也没有把编译错误或预期失败计为通过。

## 复现命令

先准备固定完整上游、依赖并应用两份补丁（见补丁目录说明）。在 Paper Reed 根目录：

```sh
python3 research/harness/check-native-guard.py --sync research/.local/Mailspring/mailsync
python3 research/harness/check-native-syntax.py --sync research/.local/Mailspring/mailsync
node research/harness/check-draft-boundaries.cjs research/.local/Mailspring
```

在 `research/.local/Mailspring` 执行 `npm run typecheck`。

获得**自己编译的补丁版引擎**后，在 Paper Reed 根目录运行四个真实协议场景：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-engine-contracts.py \
  --upstream research/.local/Mailspring \
  --binary /absolute/path/to/patched/mailsync \
  --output research/.local --expect-fixed
```

该模式要求旧稿被拒绝、两个不同任务只有一次 SMTP 提交、两处 SIGKILL 恢复均为 `send-unknown` 且不重投。未指定 `--expect-fixed` 时仍保留原固定二进制的缺口复现模式。`--case` 可缩小场景。输出记录被测二进制的 SHA-256。

## 尚未通过的边界

1. **完整引擎构建与协议回归。** 11 月 16 日已完成完整构建、原四项协议回归，以及接受后崩溃、副本写入失败场景。取消发送和真实邮箱实验仍未完成，详见后续验证记录。
2. **CLI 的结果契约。** 补丁防止重投，但还没有实现 CLI 同 requestId 重试返回完整原操作结果的接口。相同 ID 已存在时保留原任务，历史清理后的重复请求会被拒绝；这不等于产品级幂等查询与交接已完成。现有 MCP 写草稿未提供修订时会被拒绝，入口仍需接入。
3. **不确定结果处理。** 不自动重发已实现为实验状态约束；人工核对、解除占用和已接受但未完成的副本修复流程尚未实现。不能把“安全停住”说成“恢复体验完成”。
4. **附件与生命周期。** 冻结的是任务 JSON；附件路径指向的字节还未制成不可变快照。发送记录保存于原本机数据库，暂不做历史淘汰；正式迁移、账号移除清理与缓存重建时保留去重记录的边界待验证。旧模型版本也会受非正文更新影响，可能出现保守冲突。
5. **完整产品接入。** 新界面、完整 GUI/CLI 共用编辑链、真实多账号/OAuth、Graph 故障场景、签名分发均未验收。上游关闭窗口仍有保存超时退出逻辑，冲突时关闭窗口如何保留未提交内容还需单独处理；本轮仅验证打开的编辑会话不会把失败当作保存成功。当前没有向真实收件人发信，也没有新增业务服务端。

这些补丁约束了继续验证的范围；暂不为解决它们引入第二套缓存、第二个队列或服务端。
