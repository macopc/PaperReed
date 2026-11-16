# Paper Reed

[English](README.en.md) · [贡献指南](CONTRIBUTING.md) · [路线图](ROADMAP.md)

[![Repository checks](https://github.com/macopc/PaperReed/actions/workflows/checks.yml/badge.svg)](https://github.com/macopc/PaperReed/actions/workflows/checks.yml)

Paper Reed 是一个面向 macOS 的开源邮件客户端探索：重视阅读、写信与日常整理的品质，并让 Claude Code、Codex、OpenCode 等外部 Agent 方便地处理邮件。

## 当前状态

**当前界面暂作首版基线；整体架构和技术选型尚未最终确定。** 仓库公开保存研究与设计过程，正在通过 Mailspring 源码补丁验证邮件核心和界面，不代表最终选定底座或完成产品实现。

- 产品方向：美观、克制的 macOS 邮件客户端，支持多邮箱、统一收件箱、快捷键与邮件整理。
- 能力优先级：优先支持外部 Agent，通过 CLI 等入口共用邮件能力；内置 AI 后续考虑。
- UI：HTML 原型暂作首版基线；实验客户端开始接通收件箱、会话／回复和写信，补充保存与冲突反馈。历史版本仅供参考。
- 技术：Mailspring、Zero 的代码研究已保存；Electron / React / TypeScript 等仅为现有候选方案。
- 实现：已有自编译引擎、实验 CLI 与真实 Electron 窗口，使用隔离的本机 IMAP / SMTP 测试邮箱验证共享草稿、发送结果、冲突和恢复。尚无可日用的客户端，真实服务商与授权未验收。
- 开源：采用 GPL-3.0-only；项目名称已确定为 **Paper Reed**。没有正式版本或可下载的客户端。

## 阅读入口

| 内容 | 入口 |
| --- | --- |
| 首版交互基线（示例数据） | [design/direction.html](design/direction.html) |
| 独立页面目录 | [design/PAGES.md](design/PAGES.md) |
| 界面探索与迭代说明 | [design/INTERFACE.md](design/INTERFACE.md) |
| UI/UX 评审记录 | [design/UX-REVIEW.md](design/UX-REVIEW.md) |
| 实验界面接入与验证 | [research/ui-validation-2026-11-16/README.md](research/ui-validation-2026-11-16/README.md) |
| 编辑状态规格 | [design/EDITOR-STATES.md](design/EDITOR-STATES.md) |
| 编辑器打磨与副本辨识 | [研究记录与截图](research/editor-validation-2026-11-16/README.md) |
| 收件人、签名与格式工具 | [控件设计与验证](research/controls-validation-2026-11-16/README.md) |
| 设置导航与签名版式 | [实际窗口与验证](research/navigation-validation-2026-11-16/README.md) |
| 通用、邮箱账号与快捷键设置 | [前后对照与验证](research/subpages-validation-2026-11-16/README.md) |
| 外观、邮件规则与文件夹设置 | [前后对照与验证](research/organization-validation-2026-11-16/README.md) |
| 首版邮件核心设计（本轮方案） | [design/MAIL-CORE.md](design/MAIL-CORE.md) |
| 邮件领域术语 | [GLOSSARY.md](GLOSSARY.md) |
| 首版技术选型与验证条件 | [design/TECH-CHOICE.md](design/TECH-CHOICE.md) |
| 历史技术选型与架构候选 | [design/ARCHITECTURE.md](design/ARCHITECTURE.md) |
| Agent 交接候选 | [design/AGENT-HANDOFF.md](design/AGENT-HANDOFF.md) |
| 源码研究与验证边界 | [research/README.md](research/README.md) |
| 视觉参考来源 | [design/REFERENCES.md](design/REFERENCES.md) |

## 查看原型

先克隆仓库：

```sh
git clone https://github.com/macopc/PaperReed.git
cd PaperReed
```

用浏览器直接打开 `design/direction.html`，无需构建或启动服务器。全部邮件及连接状态均为演示；刷新会恢复初始状态，不会安装 CLI、唤起 Agent 或发送邮件。

修改主原型后，重新生成独立页面：

```sh
python3 design/build-previews.py
```

`design/direction-v*.html` 与 `design/INTERFACE-v*.md` 是历史探索快照，不是当前规范。历史文案如有“已确认”“既定”等表述，以本文件的未定稿状态为准。

## 后续待确定

以首版邮件核心设计约束真实邮箱实验，验证 UI / CLI 共用草稿、发送与整理，再确定技术底座、同步与存储方案、CLI / Agent 接入机制。打包与授权也需验证。现有模拟检查通过不等于工程路线已经成立。

## 参与贡献

欢迎用中文或英文提交 [Issue](https://github.com/macopc/PaperReed/issues/new/choose) 或 Pull Request。目前最有帮助的是具体的界面问题、真实邮件工作流，以及带证据的技术路线比较。大型实现请先讨论，避免建立在尚未确认的方案上。

本地基础检查需要 Python 3.10+ 和 Node.js 22+，无需安装 npm 依赖：

```sh
python3 scripts/check.py
```

检查涵盖生成页面一致性、JavaScript 语法、JSON 格式和本地文档链接；不运行浏览器交互或真实邮箱集成。详见 [贡献指南](CONTRIBUTING.md) 和 [路线图](ROADMAP.md)。

## 许可证与来源

Copyright (C) 2026 Paper Reed contributors. 本仓库原创内容采用 [GNU GPL v3.0 only](LICENSE)，不提供担保。上游源码、第三方素材与商标不因本仓库而改变其许可或归属，详见 [来源说明](THIRD_PARTY_NOTICES.md)。本项目与 Spark、Mailspring、Zero 及其维护方没有隶属或背书关系。

邮件模板与 Agent 设置的实际窗口、CLI 权限验证和边界见 [本轮验证记录](research/template-agent-validation-2026-11-16/README.md)。

CLI 安装、连接诊断和 Agent 交接见 [使用说明](research/cli/README.md) 与 [实际验证](research/cli-onboarding-validation-2026-11-16/README.md)。

收件箱搜索、批量整理及共用 CLI 命令见 [实际窗口与验证](research/inbox-validation-2026-11-16/README.md)。

置顶、稍后处理、自定义标签与 CLI 共用状态见 [实际窗口与验证](research/triage-validation-2026-11-16/README.md)。

本机邮件规则、自动分类与预览应用见 [实际窗口与验证](research/rules-validation-2026-11-16/README.md)。

附件、CLI 写信闭环与账号颜色贯通见 [实际窗口与验证](research/attachments-validation-2026-11-16/README.md)。

实现质量审查及针对性修复见 [审查报告](research/quality-review-2026-11-16/README.md) 和 [修复验证](research/quality-fixes-validation-2026-11-16/README.md)。
