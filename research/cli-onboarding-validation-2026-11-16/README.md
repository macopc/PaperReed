# CLI 安装与 Agent 接入验证

上一轮已提交推送为 `dcd9706`。本轮见 [0016 补丁](../patches/0016-cli-agent-onboarding.patch)，在桌面 0015 后应用，无需重编译同步引擎。CLI 与安装助手的源文件在 [research/cli](../cli/README.md)，补丁将相同文件放入桌面内部包。

| Before | After | Why |
| --- | --- | --- |
| CLI 依赖开发 checkout、Node 和三个环境变量 | 设置页安装用户级命令，复用桌面运行环境及 SDK | 普通用户无需理解源码目录和依赖 |
| 初次失败只提示缺少环境变量 | doctor、命令帮助、输入／认证／连接错误及恢复提示 | 让用户能验证连接并找到下一步 |
| 安装说明只链接到实验文档 | 安装 → 检查连接 → 复制接入说明，主按钮随进度变化 | 缩短首次接入路径 |
| 交接仅包含邮件引用 | 携带引用、可执行读取命令、冲突与发送约束 | Agent 可以直接开始读取当前任务 |
| CLI 只覆盖草稿和发送结果 | 增加账号、文件夹、会话与搜索读取命令 | 列表和会话页的交接也有对应入口 |
| 每次 CLI 调用留下 HTTP session | 调用结束释放 session | 连续使用不会积累无用连接 |

没有新增后台服务、全局 npm 包、数据库或第二套邮件权限。CLI 通过现有本机 MCP 调用共用接口。安装不改写 shell 启动文件和 Agent 客户端配置。

## 已执行验证

使用真实 macOS Electron、CLI/MCP、原生同步引擎及本机 IMAP/SMTP；隔离配置和 loopback-only 沙箱。安装目录专门放在忽略的测试目录中，包含空格和单引号，没有向用户真实 ~/.local/bin 写入命令。**SMTP 提交数为 0**。

- 从未安装状态点击写信窗口的 Agent 入口，进入安装设置；通过真实按钮安装和检查连接。
- 真实 launcher 使用 Electron 的 Node 运行模式，命令参数中无需外部 Node 或开发 checkout；可执行 help、doctor、账号／文件夹／会话／搜索和草稿命令。
- 命令路径带空格和单引号；直接运行复制任务里的 shell 引用命令，成功读取原草稿。
- 已有无关命令时禁用安装；符号链接也被识别为冲突，原文件内容保留。
- 专用目录 0700、连接文件 0600；放宽为 0644 后 CLI 拒绝使用，恢复后可正常连接。
- 只读权限拒绝创建草稿；切换“阅读与草稿”后，已安装 CLI 修改正文，回到 GUI 看到相同内容。
- doctor 正确报告有账号和零授权账号；非法 JSON 返回可操作的错误提示。
- 邮箱和草稿交接包含 CLI 命令；草稿携带 revision；复制内容不包含令牌。剪贴板最终写入被 harness 拦截，没有覆盖用户剪贴板。
- 更换令牌后旧连接被拒绝，设置页显示待更新；更新 CLI 连接后恢复。
- 关闭本机服务后，CLI 返回 connection-unavailable，GUI 检查显示中文恢复提示；重新启用后恢复。
- CLI 调用完成后，服务端活动 HTTP session 数为 0。
- 卸载取消保留文件，确认删除命令和连接文件，随后可重新安装。
- 1440×900 和 900×700 的实际截图；窄窗口无横向溢出。
- TypeScript 通过；14 份桌面补丁在固定基线重放，59 个文件与测试源码逐字节一致；两份 CLI 源文件与桌面内副本完全一致。

[实际窗口](index.html) · [机器结果](result.json) · [验证脚本](../harness/check-cli-onboarding.cjs) · [CLI 使用说明](../cli/README.md)

```sh
PAPER_REED_CLI_ONBOARDING_CHECK=1 \
sandbox-exec -f research/harness/loopback-only.sb \
research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --controls
```

旧的工作台验证脚本同步适配了新的安装前置条件和交接文案；本轮未完整重跑其中的发送流程。旧的模板设置脚本同步更新 CLI 帮助选择器。本轮不会据此宣称所有旧流程已经重新验收。

## Developer Experience Review

### Target

Product: Paper Reed 实验桌面。Surface: CLI 安装、连接、Agent 任务交接。Persona: 已接入邮箱、习惯使用编程 Agent 的首次用户；不熟悉开发 checkout 或 MCP 环境变量。

### Summary

Overall score: **8/10（实验接入流程，主观评分）**。Status: **Usable with friction**。

TTHW measured: 在桌面和邮箱已就绪的隔离环境中，从点击安装到 GUI 连接检查成功为 **860 ms**。这是自动化点击与执行耗时，不是人工学习时间，也不包括安装桌面、邮箱登录或第三方 Agent 的审批时间。

操作路径为“打开 Agent 设置 → 安装 CLI → 检查连接 → 复制到 Agent”。先前需要寻找 checkout、准备 Node／SDK、创建 token 文件、设置三个环境变量后手动拼接命令；旧版 doctor 实测只返回 usage，首次调用只提示缺少环境变量，没有完整修复路径。

### Journey Tested

安装、帮助、首个只读结果、输入错误、读取邮件、GUI/CLI 草稿更新、权限限制、令牌失效、服务离线、卸载和重新安装。

### Findings

- **DX-001（已修复，原高严重度）**：首次用户无法脱离开发目录使用 CLI。现由应用自带环境运行，安装后调用不依赖开发变量。
- **DX-002（已修复，原中严重度）**：没有连接诊断。新增 doctor 和结构化恢复提示，认证与离线分开解释。
- **DX-003（已修复，原中严重度）**：上下文不能直接执行。交接包含引用与读取命令，并实际执行验证带空格／引号的路径。
- **DX-004（剩余，中严重度）**：仍需要将说明粘贴给 Agent；没有自动发现、启动或注册第三方客户端。保留此明确步骤，下一轮应选一个真实 Agent 做交互验收。
- **DX-005（剩余，发布阻塞）**：安装目前仅在实验 Electron 运行环境验证。正式签名 app 的资源打包、运行模式、移动／升级后恢复需单独验证，不能据此宣称正式分发已就绪。

### Scorecard

| Dimension | Score | Evidence |
| --- | --- | --- |
| Time to hello world | 9 | 已就绪桌面中，安装与检查仅两个按钮 |
| Setup clarity | 8 | 主按钮随进度切换；PATH 说明折叠且可复制完整路径 |
| Error quality | 8 | JSON、认证、离线、权限和不安全连接文件均有可识别结果 |
| Examples and docs | 8 | 每个命令有 --help；README 覆盖常见恢复路径 |
| API/CLI coherence | 8 | 延用共用草稿和 MCP 权限；结构化输入输出 |
| Troubleshooting | 8 | doctor、连接更新、卸载重装实测 |
| Production trust | 5 | 尚无正式签名发布包和逐客户端验收 |

### Not Tested

未运行 Claude Code、Codex、OpenCode 的真实会话，不声称已完成三者配置集成。未验证正式签名／公证应用的 Electron fuses、更新器和卸载生命周期；完整 VoiceOver、多账号、离线超时长连接、安装磁盘错误仍需后续检查。发送逻辑沿用既有共用接口；本轮未发送邮件。端口更新的安装状态使用同一连接比较机制，但本轮专门复测的是令牌更换恢复；端口监听切换本身见上一轮记录。

### Recommended Next Step

用一个真实 Agent 完成“安装 → 阅读指定会话 → 修改草稿 → 回到 GUI 确认”的端到端体验，再决定是否加入客户端专用的一键注册或启动入口。
