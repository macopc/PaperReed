<p align="center">
  <img src="assets/brand/app-icon.png" width="76" alt="">
</p>

<h1 align="center">Paper Reed</h1>

<p align="center"><strong>为 AI Agent 打造的开源 Mac 邮件客户端。</strong></p>

<p align="center">
  让 Claude Code、Codex 或 OpenCode 通过本机 CLI 搜信、读信、整理收件箱和起草回复。回到 Paper Reed，打开同一份草稿审阅。
</p>

<p align="center">
  <a href="https://github.com/macopc/PaperReed/releases/latest"><strong>下载最新版 · Apple Silicon</strong></a>
  · <a href="README.en.md">English</a>
</p>

![Paper Reed 桌面编辑器里，由 Codex 起草并且已经保存的供应商回复](research/agent-receipts-2026-11-18/reply-review.png)

*Codex 创建的回复草稿，在 Paper Reed 中打开审阅。以下截图均来自实际运行的开发构建，使用合成邮件。*

## 从一条任务开始

> 回复工作邮箱中更新 PO-418 交期的供应商，说新交期可以，请他们确认发货时间。写好给我看。

实测中，Codex 用 `paper-reed` 找到对应会话，保存了保留原信引用的回复草稿。CLI 返回保存回执，桌面打开的是同一份草稿。[8 个 Agent 工作流与实测记录](research/agent-receipts-2026-11-18/README.md)

## 接入你的 Agent

在 **设置 → Agent 连接** 开启本机连接并安装 `paper-reed`。选择邮箱范围和操作权限，点击「复制接入说明」，把内容贴给能执行本机命令的 Agent。使用时保持 Paper Reed 运行。

可以只授权阅读，也可以允许建稿或整理。发送需要单独开启发送权限。[CLI 使用说明](research/cli/README.md)

| 给 Agent 的权限 | 你在 Mac 上看到的收件箱 |
| --- | --- |
| ![Agent 连接页面，展示 CLI 已安装以及阅读与草稿权限](research/cli-onboarding-validation-2026-11-16/installed.png) | ![Paper Reed 统一收件箱，展示搜索和账号颜色](research/agent-receipts-2026-11-18/inbox.png) |

桌面端支持 Gmail、iCloud 和通用 IMAP／SMTP。在统一收件箱里即时搜索，按 `⌘K` 打开命令面板，或用置顶、稍后、标签和本机规则整理邮件。

## 安装测试版

下载 ZIP，解压后把 `Paper Reed.app` 拖进「应用程序」。`0.0.4` 及更早版本需要手动升级一次。包含客户端更新器的稳定版可从应用菜单选择「检查更新」，下载完成后重启安装。邮箱兼容性仍在验证，通用账号需要服务商开放 IMAP／SMTP。[安装包、版本说明与校验值](https://github.com/macopc/PaperReed/releases/latest)

## 在这里参与

Paper Reed 在本机运行，直接与邮箱服务商连接，无需部署 Paper Reed 服务端。桌面端基于固定版本的 Mailspring 和 Mailspring-Sync 构建，改动以补丁维护。[源码与补丁](research/patches/README.md) · [研究与验证记录](research/README.md)

欢迎提交具体的邮件操作场景、界面问题或小型改进。报告问题时请附上版本、复现步骤与脱敏截图。[提交 Issue](https://github.com/macopc/PaperReed/issues/new/choose) · [贡献指南](CONTRIBUTING.md) · [路线图](ROADMAP.md)

想看设计过程，可以把仓库克隆到本地，用浏览器打开 [交互原型](design/direction.html)。原型使用示例数据，无需启动服务。[页面目录](design/PAGES.md) · [界面设计](design/INTERFACE.md)

本仓库原创内容以 [GPL-3.0-only](LICENSE) 发布。上游代码与素材沿用各自许可。[第三方来源与许可](THIRD_PARTY_NOTICES.md)
