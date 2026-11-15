# Paper Reed

[English](README.en.md) · [贡献指南](CONTRIBUTING.md) · [路线图](ROADMAP.md)

[![Repository checks](https://github.com/macopc/PaperReed/actions/workflows/checks.yml/badge.svg)](https://github.com/macopc/PaperReed/actions/workflows/checks.yml)

Paper Reed 是一个面向 macOS 的开源邮件客户端探索：重视阅读、写信与日常整理的品质，并让 Claude Code、Codex、OpenCode 等外部 Agent 方便地处理邮件。

## 当前状态

**当前界面暂作首版基线；整体架构和技术选型尚未最终确定。** 仓库公开保存研究与设计过程，正在设计邮件核心，不代表选定 Mailspring 底座或完成产品实现。

- 产品方向：美观、克制的 macOS 邮件客户端，支持多邮箱、统一收件箱、快捷键与邮件整理。
- 能力优先级：优先支持外部 Agent，通过 CLI 等入口共用邮件能力；内置 AI 后续考虑。
- UI：当前原型暂作首版基线，先推进邮件核心设计；真实数据、异常状态与可访问性仍需验证。历史版本仅供参考。
- 技术：Mailspring、Zero 的代码研究已保存；Electron / React / TypeScript 等仅为现有候选方案。
- 实现：目前只有使用示例数据的 HTML 交互原型，没有可用的邮件客户端、真实 CLI、邮箱授权或同步服务。
- 开源：采用 GPL-3.0-only；项目名称已确定为 **Paper Reed**。没有正式版本或可下载的客户端。

## 阅读入口

| 内容 | 入口 |
| --- | --- |
| 首版交互基线（示例数据） | [design/direction.html](design/direction.html) |
| 独立页面目录 | [design/PAGES.md](design/PAGES.md) |
| 界面探索与迭代说明 | [design/INTERFACE.md](design/INTERFACE.md) |
| UI/UX 评审记录 | [design/UX-REVIEW.md](design/UX-REVIEW.md) |
| 首版邮件核心设计（本轮方案） | [design/MAIL-CORE.md](design/MAIL-CORE.md) |
| 邮件领域术语 | [GLOSSARY.md](GLOSSARY.md) |
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
