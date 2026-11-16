# 冲突后另存副本与重启恢复

2026-11-16。开始本轮前，上一轮未保存编辑保护已提交推送为 `6bd8ad6`。本轮在固定 Mailspring 实验底座上补充最小的副本恢复路径；不是 Paper Reed 视觉界面的最终实现。

## 行为

写信窗口保存遇到 `draft-conflict`，用户关闭窗口时可以选择：

- **Keep Editing**：默认选项，也是取消操作的结果。保留窗口和未保存输入，不创建副本。
- **Save Copy and Close**：冻结本地内容，以新草稿身份保存；收到原生保存成功回执后关闭。原草稿仍保留 CLI 已提交的最新版本。

副本沿用共享 `saveDraft` 服务和原生任务队列，保存在同一个邮件数据库中。保留账号、发件人、To/Cc/Bcc、主题、正文格式和回复／转发引用字段；生成新的 Message-ID，不带上旧草稿的数据库身份、修订和插件调度元数据，也不发邮件。产品界面的副本标识和定位方式仍待设计，本轮不修改邮件主题来标记副本。

复制失败不会关闭窗口。等待回执时重复关闭不会再开一个保存流程；若保存期间继续输入，已保存的副本保留，但新增输入仍留在原窗口，提示用户继续处理。附件副本目前明确拒绝保存并保持窗口，避免静默遗漏附件。代码见 [0006-conflict-recovery-copy.patch](patches/0006-conflict-recovery-copy.patch)。

## 实际桌面验证

[check-compose-handoff.py](harness/check-compose-handoff.py) 的 `--recover` 模式运行独立 CLI、真实桌面 MCP、实际写信窗口和自编译 mailsync：

1. CLI 创建草稿；真实鼠标、键盘输入 GUI 正文但尚未保存。
2. CLI 提交另一份正文。GUI 自动保存、发送均拒绝旧修订。
3. 正常关闭时选择继续编辑，检查窗口、dirty 状态和本地正文仍在，原稿仍为 CLI 新版本。
4. 再次正常关闭时选择另存副本，等待窗口关闭。只读查询发现恰好一份新草稿；CLI 读取到本地正文、主题和 Cc/Bcc，原稿内容及修订不变。
5. 正常退出整应用，用相同配置与数据库启动新 Electron 进程；CLI 再次读取两份草稿。
6. 分别打开原稿和副本的真实写信窗口，检查完整可见正文和干净的编辑状态，随后正常关闭。所有发送操作数与 SMTP 投递数均为 0。

完整路径连续通过两次，结果见 [recovery-copy-results.json](recovery-copy-results.json)。第二次进一步比较重启后的 To/Cc/Bcc、主题和格式，以及规范化空白后的完整可见正文。

第一轮试跑暴露了测试断言的问题：重开窗口时 Slate 把 `<br/>` 换行规范化为块元素，正文 HTML 与保存值不再逐字节一致。CLI 在重启前后读取的存储正文仍逐字节一致。调整为分别检查存储字节和完整可见文本，没有修改编辑器或跳过正文验证。

原有无冲突“未保存输入 → 关闭保存”和“自动保存 → 发送 → CLI 查询 accepted / filed”的回归结果也记录在同一 JSON 中。

## 故障边界检查

[check-recovery-boundaries.cjs](harness/check-recovery-boundaries.cjs) 从实际 TypeScript 中提取关闭方法，并运行真实共享副本服务；只替换窗口、模型和持久化依赖。它不是 Electron 或真实磁盘故障验证。

- 取消时不保存副本，也不释放会话。
- 注入副本保存失败，关闭回调不执行，原输入保留并报告错误。
- 延迟保存回执，重复关闭只创建一份副本，回执到达后才允许关闭。
- 保存期间新增输入，冻结副本保持旧快照，窗口继续保留新输入。
- 账号授权／可见性拒绝和附件拒绝均不入队；正常副本保留字段与引用，使用新身份和保存回执，不继承调度元数据。

既有草稿边界检查和上游完整 TypeScript 检查通过。0006 在临时目录从固定基线叠加 0002–0005 后实际应用，与被测两个文件逐字节一致。

## 复现与范围

按 [补丁说明](patches/README.md) 准备本地 checkout，在仓库根目录运行：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --recover

node research/harness/check-recovery-boundaries.cjs research/.local/Mailspring
```

沿用 [完整窗口验证](compose-handoff-validation.md) 的固定源码、自编译引擎、测试 KeyManager 凭据和 loopback IMAP/SMTP。没有真实邮箱访问，没有新增服务端、恢复数据库或后台备份进程。原始配置、令牌、数据库和日志只放在忽略目录。

原生提示框由测试适配器记录并选择返回值；保存、关闭和重启均执行真实业务路径，未验收提示框的视觉呈现。重新打开使用现有 `Actions.composePopoutDraft` 入口，不代表已经完成从 Paper Reed 草稿列表定位副本的交互。

本轮“恢复”指**用户主动另存成功后，重启客户端重新打开副本**。未验收强制退出／崩溃前的自动备份、断电持久性、保存成功但回执丢失时的幂等恢复、远端 IMAP 副本同步完成和跨设备恢复。主窗口内嵌回复、附件和整应用退出时的冲突提示也不在本轮完整窗口验证范围内。保存期间继续输入后再次选择另存，可能有多份不同快照；它不是自动去重的备份系统。
