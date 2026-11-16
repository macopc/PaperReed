# 编辑器与恢复副本辨识

在 `4685f9a` 的真实工作台上继续打磨，先按 [设计差异评审](../../design/EDITOR-GAP-REVIEW.md) 对照现有设计，再调整共用编辑器和本机恢复元数据。实验仍基于固定版本的 Mailspring，不代表最终选型、设计批准或可日用版本。

## 这轮变化

- 实际邮件主题作为可编辑标题，长主题自动换行；发件人在前，收件人和正文共用 640px 版心。回复沿用同一组件。
- 常用字段中文化，格式工具按需展开；附件、格式靠左，Agent 上下文与发送靠右。普通保存状态保持安静，冲突不再重复叠加全页报错。
- 草稿列表区分原稿及“恢复副本 1 / 2”，显示创建时间；打开副本后可查看原稿。编号按同账号、同原稿递增，删除第一份后第二份仍为 2。
- 来源记录由同步引擎写入现有数据库，与副本在同一事务保存或回滚。GUI 只读；来源不进入邮件主题、邮件头或正文。没有新增服务端或同步队列。

[交互对照](index.html) 可切换写信／回复的设计、调整前与调整后，并查看冲突、副本、长主题和来源不可用。图片都是实际 Electron 截图或既有设计基线截图，未重画产品截图。设计内容与测试邮件不同；副本页尚无一对一的原设计稿，不将参考页充当副本设计。

## 已验证

实际 Electron + 实验 CLI + 桌面 MCP + 自编译同步引擎，使用独立数据目录及 loopback IMAP / SMTP 测试服务。测试样本为 8 封虚构邮件；1440×900 与 900×700 是渲染视口，不是两台物理显示器。

- 真实收件箱、阅读、回复、写信；正文与编辑器宽度均为 640px，紧凑列表无横向溢出。
- 发件人 DOM 次序、格式展开／收起、长主题换行；输入法组合态 Enter 的合成事件不被主题导航吞掉。这不等于完整中文输入法人工验收。
- CLI 修改原稿后，GUI 未保存编辑保留、发送禁用、导航受阻；连续保存两份不同编辑，明确载入最新原稿。
- 两份副本的内容、来源和编号在重启后保留；“查看原稿”打开真实写信窗口。原稿发送后说明来源不可用，副本仍可编辑；删除一份后列表隐藏该副本，另一份不重新编号。
- Agent 上下文使用已保存的最新版本；设置返回后保留当前草稿。GUI 发送后持续显示结果，SMTP 只收到一次，To/Cc/Bcc 三个收件人完整且没有 Bcc 邮件头。
- 原生测试验证副本及来源事务回滚、更新／非法来源拒绝、跨账号隔离和稳定编号；既有并发发送、崩溃恢复与版本冲突检查继续通过。
- TypeScript 全量检查、草稿边界与恢复边界检查通过。补丁从固定版本顺序应用后，源码逐字节相同，见 [补丁核对](patch-check.txt)。

摘要：[result.json](result.json)、[验证记录与指纹](validation.txt)。测试入口：[工作台流程](../harness/check-paper-reed-ui.cjs)、[原生事务检查](../harness/native/mail-mutation-guard-test.cpp)。

按 [补丁顺序](../patches/README.md) 准备 0001–0009、依赖和重新构建的引擎后运行：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --workspace
research/.local/venv/bin/python research/harness/check-native-guard.py \
  --sync research/.local/Mailspring/mailsync
node research/harness/check-recovery-boundaries.cjs research/.local/Mailspring
node research/harness/check-draft-boundaries.cjs research/.local/Mailspring
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/check.py
```

## 还没达到设计稿的部分

后续更新：[控件打磨](../controls-validation-2026-11-16/README.md) 已继续处理第 1 项的补全、签名选择及格式栏；此处保留当时的评审基线。

1. 收件人补全菜单、签名按钮、展开后的富文本工具、部分二级菜单仍是上游控件；标题和字段布局已收敛，整套控件视觉尚未统一。
2. 弹出窗口共用编辑器，但窗口工具栏、菜单和主窗口的关系还未完整打磨。长主题加抄送／密送会增加滚动，尚需评审小窗口中的操作可达性。
3. 副本标签为本机恢复身份，不是跨设备同步标签。旧版副本不猜测来源；来源数据目前保留供稳定编号使用，正式版本还需结合账号删除处理生命周期。含附件的恢复仍明确拒绝，不丢弃附件。
4. Agent 仍是复制当前引用及打开连接设置；安装 CLI 和一键启动 Agent 尚未完成。多账号真实服务商、全键盘路径、VoiceOver、离线状态和大邮箱性能也未完成验收。

本轮优先收敛结构和可理解性，未新增通用版本管理系统。原生实验迁移继续沿用既有方式；发布前仍需要正式版本化迁移、打包与签名验证。
