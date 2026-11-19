# Contributing / 贡献指南

欢迎用中文或英文参与 Paper Reed 的桌面测试版。小型改进可以直接提 PR；较大的界面、架构或邮件协议改动请先开 Issue 讨论。

## Where to help / 可以参与什么

- 用具体场景指出导航、阅读、写信、整理或 Agent 交接的问题。
- 比较技术路线：注明源码版本、实验方法、结果及尚未验证的部分。
- 改进原型、可访问性、文档和开发体验。大型实现先开 Issue 讨论。

Design feedback, workflow examples, reproducible research and small prototype improvements are welcome. Please discuss substantial implementation before starting; neither the UI nor the architecture is finalized.

## Local workflow / 本地工作流

1. Fork 仓库并建立描述性分支。
2. 原型主源为 `design/direction.html`；不要分别修改 `design/pages/`。历史 `direction-v*.html` 和 `INTERFACE-v*.md` 保留为过程记录。
3. 修改主原型后执行 `python3 design/build-previews.py`。
4. 使用 Python 3.10+、Node.js 22+ 执行 `python3 scripts/check.py`。
5. 界面修改请实际打开原型，检查受影响流程、键盘焦点和不同窗口宽度；附匿名截图或简短复现步骤。基础 CI 不会替你完成视觉评审。
6. 提交 PR，说明问题、修改后的行为、验证结果和剩余限制。

Edit the canonical prototype, regenerate standalone pages, run the checks, and manually inspect affected UI flows. Explain the problem, behavior change, validation and limitations in your PR. Keep unrelated changes separate.

源码补丁使用固定上游版本。新增或修改补丁后执行：

```sh
python3 scripts/prepare-desktop.py /tmp/paper-reed-check --typecheck
```

目标目录必须尚不存在。脚本准备桌面与原生源码、顺序应用补丁、比对 CLI 副本，并从锁文件安装类型检查依赖；CI 运行同一入口。它不构建原生引擎或可运行安装包，真实 Electron / IMAP / SMTP 回归仍需本地实验环境，见 [research/README.md](research/README.md)。可用 `--source <本地上游 checkout>` 复用 Git 对象，用 `--compare <已测试 checkout>` 比对补丁输出。现有 32 项原型交互检查也不属于静态 CI，不能把语法检查通过写成全部交互通过。

## Contribution terms / 贡献约定

提交你有权分享的内容；原创贡献按本仓库 GPL-3.0-only 提供。不要求签署 CLA。复用第三方代码时保留来源、版权与许可说明，并说明与当前项目的关系。不要上传真实邮件、邮箱凭据或未匿名的个人信息。

Contribute only material you have the right to share, under GPL-3.0-only for original contributions. No CLA is required. Preserve notices and provenance when incorporating third-party work. Keep real mail, credentials and personal data out of examples.

遵守 [行为准则](CODE_OF_CONDUCT.md)。涉及漏洞或凭据泄露请使用 [安全报告方式](SECURITY.md)，不要提交公开 Issue。

配置完整的 macOS 预览包使用 `python3 scripts/build-desktop.py --google-client <项目桌面客户端JSON路径> --skip-archive`。该入口要求项目自己的 Google Desktop 配置，写入 Paper Reed 版本和源码标识；不会打包邮箱授权令牌。前提、验证和未完成的正式发行事项见 [发行配置记录](research/distribution-validation-2026-11-17/README.md)。
