# 未保存编辑与 CLI 新修订的冲突交接

2026-11-16。开始本轮前已提交并推送上一轮完整窗口交接为 `fab51f2`。本轮在同一真实桌面、MCP 和自编译引擎链路中，复现并修复了一个关闭窗口丢失未保存输入的问题。

## 复现与修复

CLI 创建修订 1 的草稿，真实写信窗口通过鼠标、键盘输入正文，保持未保存。随后独立 CLI 以修订 1 保存另一份正文，数据库成为修订 3。

原有修订保护正确阻止了 GUI 的空闲自动保存和发送：本地编辑会话仍保留修订 1 与未保存输入，CLI 新正文没有被覆盖，也没有创建发送操作。但是，用户正常关闭写信窗口时，`DraftStore._onBeforeUnload` 会在 700 毫秒后无条件放行。即使保存已被拒绝，也会丢弃编辑会话并关闭窗口。修复前运行 `compose-handoff-6zq830vm` 在“冲突必须阻止关闭”的断言处失败。

[0005-unsaved-draft-close.patch](patches/0005-unsaved-draft-close.patch) 删除这个超时放行。只有保存成功才清理会话并继续关闭；保存失败则保留窗口和未保存内容，并提示先保留编辑副本，再载入最新草稿。沿用已有保存回执与修订检查，没有增加服务、数据库或自动合并机制。

## 验证范围

- 冲突路径重复通过三次：GUI 自动保存拒绝、发送拒绝、正常关闭被阻止；关闭请求 1.5 秒后仍能读取本地未保存正文，CLI 则读到修订 3 的新正文。发送操作数和 SMTP 投递数均为 0。最后一次额外断言关闭失败提示说明窗口会保持打开。
- 无冲突的关闭路径通过：在真实编辑器尚有未保存输入时立即关闭，窗口保存成功后正常关闭，独立 CLI 读到新正文与更高修订；SMTP 投递数为 0。
- 正常写信发送回归及匿名结果记录在 [unsaved-conflict-results.json](unsaved-conflict-results.json)。
- 既有草稿边界检查通过：失败保留 dirty 状态、保存后新增输入仍为 dirty、失败阻止调用方继续、只有成功回执更新修订。
- 上游完整 TypeScript 检查通过。0005 从固定基线依次叠加 0002 / 0003 / 0004 后实际应用，并与被测 `draft-store.ts` 逐字节比较一致。

## 隔离与测试适配

复用 [完整窗口验证](compose-handoff-validation.md) 的固定源码、自编译引擎、真实 KeyManager 测试凭据、桌面 MCP 注册器、真实 bearer 认证和本机协议 fixture。未启用 `PLAYWRIGHT` 业务模拟；CSP 保持开启，OS 沙箱只允许 loopback 网络。没有授权或访问真实邮箱。

冲突模式唯一新增的应用适配，是把 `AppEnv.showErrorDialog` 替换为记录提示文本并自动确认，以避免原生模态对话框阻塞自动化。**未验收原生提示框的外观和交互**；保存、发送、修订检查、任务队列和关闭回调均未替换。Playwright 的 beforeunload 事件不自动回答，由 Electron 正常处理取消关闭；否则 Playwright 会尝试响应不存在的 Chromium 对话框，产生工具错误。

关闭请求调用正常 `AppEnv.close()`，经过真实 beforeunload。冲突断言结束后仅为清理测试而强制销毁自建测试窗口；这一步不计为内容恢复或持久化证据。原始日志、截图、配置、数据库和令牌均留在忽略的 `research/.local/`，不提交。

在仓库根目录运行，先按 [补丁说明](patches/README.md) 准备实验 checkout：

```sh
# GUI 未保存 + CLI 新修订 + 自动保存/发送/关闭
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --conflict

# 无冲突，立即关闭仍有未保存输入的窗口
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --close-save

# 原有自动保存、发送、CLI 查询结果的完整回归
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring
```

## 尚未完成

本轮只证明正常关闭写信窗口不会丢弃冲突输入。内容仍保留在打开的编辑器内，不是独立持久化的恢复副本；整应用退出、强制退出、崩溃后恢复、保存过程中继续输入等场景未在本轮验收。

产品层的冲突交接还需一个简洁的明确选择：保留本地编辑副本，或在用户确认后载入最新草稿。当前提示与阻止关闭只是底层保护，尚无版本比较、另存副本和重新载入的完整操作路径。附件、真实邮箱、多账号及 Paper Reed 设计界面接入仍按此前边界推进。
