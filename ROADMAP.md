# 路线图 / Roadmap

Paper Reed 已发布 [0.0.2 测试版](https://github.com/macopc/PaperReed/releases/tag/v0.0.2)。近期的重点是让现有桌面客户端和 Agent CLI 在日常使用中更可靠。

| 方向 | 当前进展与下一步 |
| --- | --- |
| 读信、写信与整理 | 统一收件箱、即时搜索、快捷键和本机整理已进入测试包。依据试用反馈继续打磨大邮箱、键盘流转和可访问性。[负载验证](research/mail-load-validation-2026-11-17/README.md) |
| 多账号与服务商 | 已有 Gmail／Google Workspace、iCloud 与通用 IMAP／SMTP 的接入路径。继续积累不同服务商的真实收发与恢复记录。要求 Microsoft 专用 OAuth 的账号目前没有对应接入路径。[接入范围](research/provider-scope-validation-2026-11-17/README.md) · [真实 Gmail 验证](research/daily-use-validation-2026-11-17/README.md) |
| 外部 Agent | CLI 与桌面共用草稿。下一轮从试用中的真实任务继续检查授权、交接与异常恢复。[8 项 Agent 用例与复验](research/agent-receipts-2026-11-18/README.md) |
| macOS 分发 | Apple Silicon 已有签名、公证的 ZIP，通过 GitHub Releases 手动安装。继续记录旧版覆盖安装、钥匙串迁移和真实 Gmail 授权表现。[0.0.2 验证范围](https://github.com/macopc/PaperReed/releases/tag/v0.0.2) |
| 内置 AI | 基础邮件体验和外部 Agent 接入优先，内置摘要与写作辅助后续考虑。 |

## English summary

The [0.0.2 preview](https://github.com/macopc/PaperReed/releases/tag/v0.0.2) is available for Apple Silicon Macs. Near-term work focuses on everyday mail reliability, real-world provider compatibility, and the handoff between an external agent and the desktop app. Built-in AI comes later. Release timing depends on what we learn from the preview.

Concrete workflow feedback and reproducible issues are welcome. [Contributing](CONTRIBUTING.md) · [Research and validation](research/README.md)
