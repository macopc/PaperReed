# Paper Reed 0.0.1 本机测试包

2026-11-17。基于 `84526aa` 加本轮 0048 补丁构建，构建身份如实保留 `-dirty`。未发布 GitHub Release、未推送 tag；未发送邮件或改动真实 Gmail profile。

## 内容

- 原创苇叶图标：macOS ICNS、原生关于窗口 PNG、工作台透明标记。纸白与苇绿沿用现有设计，不新增图标库。
- 应用包、工作台、关于窗口及 CLI 用户可见版本为 `0.0.1`。内部诊断继续保留源码提交编号，上游版本单独保留。
- ZIP 名称包含版本与架构；准备／构建脚本复制已生成的品牌资源，不为普通构建引入浏览器依赖。
- [0048 补丁](../patches/0048-version-and-brand.patch)与 [图标源文件](../../assets/brand/README.md)。无邮件核心或原生引擎改动。

## 安装与构建

本机产物：`research/.local/Mailspring/app/dist/Paper-Reed-0.0.1-macOS-arm64.zip`（约 211.3 MiB）。ZIP 被 Git 忽略；可解压后将 `Paper Reed.app` 放入应用程序目录。退出旧实例后再打开新应用；打包不会更新正在运行的进程。

先按 [贡献指南](../../CONTRIBUTING.md)准备补丁源码、依赖与原生引擎，再构建：

```sh
python3 scripts/build-desktop.py --google-client '/绝对路径/Google-Desktop-client.json'
```

不包含用户邮箱凭据。包内包含项目 Desktop OAuth 身份配置，不代表该 Google 项目已允许所有用户登录。

## 实际验证

- 完整构建生成 ZIP，再解压到含空格的新路径运行，不依赖原构建目录中的 app。[构建日志](build.log)、[包元数据](package.json)、[SHA256](SHA256SUMS)。
- Info.plist 两个版本字段均为 0.0.1，ICNS 与仓库资源逐字节一致，不再指定上游 `.icon` 资源目录。构建日志中缺少可选 `.icon` 的警告不影响实际 ICNS 打包；未声称制作了新版 Icon Composer 分层资源。
- 新配置启动到连接页；无 OAuth 环境变量时使用包内项目身份，取消后关闭回调并保持零账号。系统浏览器打开被测试拦截，没有代替用户授权。[结果](distribution.json)、[日志](distribution.log)、[首用截图](installed-onboarding.png)。
- 解压后的应用打开隔离复制的 **3 个模拟账号、30,000 个会话**，实际图标加载成功，版本标签正确。随包安装器在含空格的路径安装 CLI，执行 `--version`、`doctor` 成功识别 3 个授权账号，再卸载测试 CLI。[结果](installed-app.json)、[日志](installed-app.log)、[运行截图](installed-inbox.png)。本次启动至列表 713 ms，仅是单次本机样本，不代表冷启动基准或真实同步性能。
- 上述缓存／CLI 测试由 macOS loopback-only 测试沙盒限制出站，Electron 自动化带 `--no-sandbox`；该参数未写入产品配置。另用不带该参数的正常应用启动检查，见 [普通启动结果](normal-launch/result.json) 与 [日志](normal-launch/run.log)。普通启动检查没有 OS 出站限制，仍拦截授权浏览器，没有保存账号。
- [TypeScript 检查](typecheck.log)通过；[48 个补丁重放](replay.log)成功，129 个涉及文件（含品牌资源）与测试 checkout 一致，CLI 副本一致。

首次安装包检查发现工作台误显示完整提交编号，已修为简短版本后重建 ZIP 并重新测试。测试脚本一次动态表达式语法错误也已修复；这里保存的是最终成功结果。原生 About 面板已接线并通过类型／构建检查，本轮未截取该原生窗口；不是 Gatekeeper、全新 Mac 或 Intel 兼容性验收。

复跑主要检查：

```sh
AUDIT_PROFILE=research/.local/multi-body-load \
TEST_EXECUTABLE='research/.local/0.0.1 clean install/Paper Reed.app/Contents/MacOS/Paper Reed' \
sandbox-exec -f research/harness/loopback-only.sb node research/harness/check-test-package.cjs

TEST_NORMAL_LAUNCH=1 node research/harness/check-distribution.cjs \
  research/.local/Mailspring \
  'research/.local/0.0.1 clean install/Paper Reed.app/Contents/MacOS/Paper Reed' \
  research/.local/paper-reed-google-client.json \
  research/version-001-validation-2026-11-17/normal-launch/result.json
```

## 发给其他测试者之前

- 仅构建并运行了 **arm64 / macOS 26.5.2**。包声明最低 macOS 13，不代表本轮在 macOS 13 或 Intel 上实测。
- 当前没有有效 Developer ID 身份，未完成应用签名／公证。[签名检查](signature.log)显示可执行文件仅有 ad-hoc 链接签名，没有完整资源封印；[身份检查](signing-identities.log)为 0。不能据此宣称可在其他 Mac 无提示安装。
- Gmail 真实授权、CLI / GUI 草稿交接见 [此前日用验证](../daily-use-validation-2026-11-17/README.md)。其他测试用户的 Google 项目访问范围／发布状态尚需验收，本轮没有重新授权或发信。
- 暂无 Paper Reed 自动更新服务。本轮不引入发布平台或服务端。

下一步优先完成签名／公证与少量真实测试者安装验证，再建立首个公开测试 Release。具体使用缺陷优先修复，不扩展新的功能体系。

## 在另一台 Mac 完成签名和公证

开发验证与发行机器可以分开，签名证书和私钥留在发行机器即可，不必复制到开发机。建议发行机器检出本轮提交，准备相同固定上游与补丁，再构建和签名，以保留清晰的源码归属。也可以交接未签名 ZIP；先核对 SHA256，解压后对应用及其嵌套代码完整签名。

首次签名前还需要调整现有配置：`app/build/resources/mac/entitlements.plist` 仍含上游 Mailspring 的 Team ID、application identifier 和 keychain group。当前无签名构建不会使用这些权限；不能仅设置 `SIGN_BUILD` 并换证书就宣称发行流程已就绪。应使用 Paper Reed 的团队／应用标识，按实际功能保留必要 entitlement；如保留受限能力，描述文件也必须匹配。首次在发行机器上验证，暂不增加跨机调度或新 CI 平台。

发行顺序：

1. 固定源码提交或核对交接包哈希，使用自己的 Developer ID Application 证书及对应私钥签名；包含 Electron helpers、原生邮件引擎及其他嵌套代码。
2. 使用 Hardened Runtime 和正确权限，通过 Apple `notarytool` 提交公证，检查结果与日志。
3. 公证通过后给 `.app` staple 票据，再生成最终分发 ZIP，重新计算 SHA256。ZIP 本身不能直接 staple；签名前的校验值不能用于最终包。
4. 对最终产物检查签名与 Gatekeeper，并在测试 Mac 验证启动、已有邮箱凭据读取和 CLI；不能用未签名包的通过记录代替这些检查。

Apple 官方流程：[Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。目前只完成了未签名测试包，尚未在另一台机器实施这些步骤。
