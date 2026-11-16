# 编辑器控件打磨与验证

基线为已推送的 `8d1282f`。本轮 [0010 源码补丁](../patches/0010-editor-controls.patch) 打磨收件人补全、签名选择与格式工具；[设计说明](../../design/EDITOR-CONTROLS.md) 记录 Before / After / Why。没有新增引擎表或服务。

[截图对照](index.html) 展示调整前、调整后以及选中签名、链接、颜色和窄窗口。全部为真实 Electron 截图；非重绘的界面示意图。

## 验证方式

使用实际 Electron、生产桌面 MCP、实验 CLI 与已有自编译引擎，在独立数据目录和仅 loopback 网络下运行。测试邮箱提供 8 封虚构邮件。两个同名联系人由 harness 写入隔离测试库及搜索索引，签名由测试配置提供；随后使用真实 ContactStore 查询与真实签名组件。**不代表已验证服务商通讯录同步或联系人导入。** 产品自身没有增加数据库写入通道。

[控件流程](../harness/check-editor-controls.cjs) 通过实际鼠标和键盘完成收件人添加、签名插入／替换／移除、格式设置和链接输入；读取 CLI 保存结果检查正文和收件人。为聚焦格式按钮的键盘激活，测试会把焦点移到斜体按钮后发送空格。输入法检查使用合成组合态 Enter，不声称已完成真实输入法验收。

[补全时序检查](../harness/check-completion-order.cjs) 执行真实源码方法，只替换搜索返回时序，覆盖旧查询晚到、Esc 作废待返回结果、已选地址过滤和组件卸载。它不是另一个联系人搜索实现。

结果见 [result.json](result.json)、[验证记录](validation.txt)；完整工作台回归见 [workspace-result.json](workspace-result.json)。测试期间控件流程不发送邮件，完整工作台流程仅向本机 SMTP 投递一次。UI 截图为渲染视口，不是物理显示器记录。

## 复现

按 [补丁说明](../patches/README.md) 准备固定版本、依赖、0001–0010 及原有 0008 引擎。0010 不要求重新构建原生引擎。

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --controls
node research/harness/check-completion-order.cjs research/.local/Mailspring
npm --prefix research/.local/Mailspring run typecheck
PAPER_REED_UI_OUTPUT="$PWD/research/.local/controls-workspace-regression" \
  sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --workspace
python3 scripts/check.py
```

调整前截图在应用 0010 之前用 `PAPER_REED_CONTROLS_PHASE=before` 采集。现在运行该模式不再代表旧基线。

## 尚未验证或完成

真实服务商通讯录、账号默认签名切换、签名管理页面的整体视觉、复杂签名 HTML、系统自定义颜色窗口、完整无障碍和所有格式组合仍需单独验证。窄窗口验证针对 900×700 的渲染视口。没有因本轮控件通过就将首版客户端标记为已验收。
