# 完整写信窗口交接验证

2026-11-16。前一轮共享接口已提交推送为 `9995744`。本轮完成 **独立 CLI → 实际桌面 MCP → 真实写信窗口编辑／发送 → CLI 查询** 的闭环，并修复一个此前窄适配器测试未暴露的桌面运行问题。

这是固定 Mailspring 底座的真实窗口，不是已实现 Paper Reed 视觉稿，也不是正式产品验收。服务端仍为本机 fake:dovecot IMAP / SMTP，没有真实邮箱授权。

## 实际通过的路径

1. 以全新配置启动桌面，账号为本机 fixture；密码使用真实 KeyManager 保存测试值。由桌面自己启动补丁版 mailsync，真实同步测试收件箱。
2. 使用桌面包管理器正常启动的 MCP Server、真实注册器和 bearer 认证。独立 `paper-reed.cjs draft-create` 创建草稿，等待原生保存后返回修订 1。
3. 通过现有 `Actions.composePopoutDraft` 打开对应草稿的真实写信窗口；这只是测试的打开入口，不是假造编辑会话，也没有实现产品的一键 Agent 交接按钮。
4. 通过实际鼠标／键盘事件，在编辑器输入 `Paper Reed GUI edit`。等待普通空闲自动保存，由 CLI 反复读取到新正文与更高修订，未通过 JS 直接改正文或伪造保存事件。
5. CLI 携带原修订尝试覆盖，返回 `draft-conflict`；CLI 重读仍保留窗口编辑内容。
6. 点击写信窗口真实 `.btn-send` 按钮。用只读查询取得 GUI 创建的发送操作 ID，再由独立 CLI `operation-get` 查到 `accepted`。
7. 本地 SMTP 实际只接收一封，正文含窗口输入。第二次确认运行增加 Cc / Bcc：GUI 自动保存后 CLI 仍能读到两者，SMTP 信封包含 To、Cc、Bcc 三位测试收件人，邮件头没有泄露 Bcc。

三次成功运行的匿名结果见 [compose-handoff-results.json](compose-handoff-results.json)。第一次验证基础路径，第二次重复该路径并增加 Cc / Bcc 断言，第三次在此基础上进一步等待已发送副本变为 `filed`。三次均退出 0，SMTP 各收到 1 封。

## 暴露并修复的问题

首轮桌面 MCP 请求返回 HTTP 500。Renderer 日志表明 Zod v4 对对象 schema 的同步解析尝试使用 `new Function`，被现有 CSP 的动态代码限制拒绝；失败发生在 SDK 判断 initialize 请求时，还未进入草稿业务处理。此前运行在普通 Node 中的 MCP 适配器测试不会触发 renderer 的 CSP，因此没有发现它。

[0004-desktop-mcp-csp.patch](patches/0004-desktop-mcp-csp.patch) 新增一个很小的 schema 运行配置模块，在导入 MCP SDK schema **之前**执行 `z.config({ jitless: true })`。安装版本的 Zod 在构造 schema 时捕获该开关，所以不能等收到请求后才设置。

保留应用原 CSP，没有加入 `unsafe-eval`，也没有关闭 `window.eval` 限制。修复后完整窗口路径连续通过。完整上游 `npm run typecheck` 也通过；补丁从基线实际应用后与被测文件逐字节一致。

## 测试隔离与复现

- 固定桌面源码 `535f13dd`，依次应用 0002、0003、0004；Sync 固定 `8681eae1` 加 0001。
- 使用此前自编译 arm64 引擎，SHA-256 为 `0209cb33ad90b19b7f5a7dd1a2d63bb128a103bab5d27b4e328cbbd1f4901b4c`，放在隔离 checkout 的 `app/mailsync`。
- Python 仅启动本地协议 fixture，**不另启一个邮件引擎**。引擎、数据库变更通知、自动保存和任务队列均由桌面运行。
- 不设置 `PLAYWRIGHT` 环境变量：上游模拟模式会跳过真实保存，本测试明确删除该变量。
- 使用新配置目录与临时 MCP token 文件，不复制现有用户邮箱数据库、令牌或凭据。启动为 `--dev`，上游不会刷新真实 Claude Desktop 配置。
- 外层 `loopback-only.sb` 禁止外网；沿用既有 `--no-sandbox` 设置避免嵌套 Chromium 沙箱启动失败。**CSP 仍开启**，但这不是正式 Chromium 沙箱或签名发行验收。
- DOM 检查和 fixture 初始化通过 CDP；实际编辑、发送使用鼠标与键盘事件。没有拦截任务、替换业务回调或直接写数据库。失败会保存匿名 DOM 与日志，结束时关闭自己的桌面进程；超时终止本测试进程组。

在 Paper Reed 根目录运行：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring
```

原始日志、隔离配置、截图与数据库位于忽略目录：基础成功运行 `research/.local/compose-handoff-yfoe7hvt`，增加 Cc/Bcc 的确认运行 `research/.local/compose-handoff-4cic51qj`，最终副本确认运行 `research/.local/compose-handoff-tbnw5691`。这些原始配置不提交；仓库只保存脚本、补丁和不含测试令牌的结果摘要。

## 仍未验收的场景

- 后续 [未保存编辑冲突验证](unsaved-conflict-validation.md) 已覆盖 GUI 未保存时 CLI 先提交、随后自动保存／发送／关闭的拒绝与内容保留；核对、另存和重新载入的产品交互仍待完成。
- 附件字节快照、回复引用、发送权限撤销后的队列处理、`unknown` 人工核对和副本修复体验。
- 真实邮箱／OAuth、多账号的完整窗口流程，以及 Paper Reed 新界面的接入、签名公证和正式沙箱。

本轮窗口交接的后续记录见 [未保存编辑冲突验证](unsaved-conflict-validation.md)，两轮证据分别保留。
