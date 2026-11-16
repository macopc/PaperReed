# 首次启动与 macOS 开发预览

本轮把已有邮件核心接到正常的首次使用流程：空白配置直接添加 IMAP / SMTP 邮箱，验证成功后进入 Paper Reed 收件箱。复用上游账号验证、系统加密凭据、同步进程、窗口管理和构建脚本，没有新建账号服务、同步框架或写入队列。

## 变化

- 应用名 `Paper Reed`，macOS bundle ID `io.github.macopc.paperreed`。普通启动默认使用 `~/Library/Application Support/Paper Reed`；开发启动使用 `Paper Reed-dev`，与 Mailspring 分开。
- 首用先填写发件人姓名、邮箱和密码，再填写收信／发信服务器、端口与安全方式。默认 TLS，保留已有证书检查；尚未验证的 OAuth 服务商不作为首用入口。
- 密码错误留在接入页，不保存半成品账号。账号验证只检查 SMTP 登录，不发送上游测试邮件。Paper Reed 的本机整理不要求创建上游辅助文件夹。
- 接入成功直接打开收件箱；同步中显示进度提示，凭据失效提供重新连接，暂时中断提供重试。正常退出后保留账号和草稿。
- 跳过上游身份／订阅引导，不自动加入登录启动项或 Dock，不弹出上游移至 Applications 的安装提示；停用上游更新、崩溃与 Sentry 上报，不改写上游 Claude Desktop 注册。
- Agent 接入默认关闭，首次开启默认只读。沿用现有设置页安装 CLI，安装后的命令读取应用保存的连接配置。

## 本机启动

已有准备好的可运行 checkout 时，在仓库根目录执行：

```sh
python3 scripts/start-desktop.py
```

可加 `--config-dir /tmp/paper-reed-preview` 使用另一个空白目录。这是正常启动入口，不注入账号、密码或邮件。源码与类型检查准备见 [贡献指南](../../CONTRIBUTING.md)；`prepare-desktop.py` 本身不会安装 Electron 运行时或构建原生引擎。

本轮使用现有打包脚本，在已完成运行依赖安装、原生引擎构建的 checkout 中执行：

```sh
cd research/.local/Mailspring
node app/build/build.js --skip-installers
```

本机 arm64 应用产物为 `research/.local/Mailspring/app/dist/Paper Reed-darwin-arm64/Paper Reed.app`。构建入口见 [0022 补丁](../patches/0022-first-run-preview.patch)，原生引擎准备见 [编译记录](../patched-engine-validation.md)。该目录受 Git 忽略，不作为开源发布附件。

## 验证方法

[测试入口](../harness/check-first-run.py) 启动本机 IMAP / SMTP fixture，再通过 [真实 Electron UI](../harness/check-first-run.cjs) 填写表单。没有直接写账号、密码、令牌或业务数据库；仅将 CLI 安装目录放进临时测试目录。测试运行在仅允许 loopback 的 sandbox 内。

1. 空白配置输入错误密码：显示认证失败，已保存账号仍为零。
2. 更正密码，连接并同步两封邮件；配置没有明文邮箱密码，不要求上游身份，更新状态为停用。
3. 在设置中开启只读 Agent 接入、安装 CLI、运行诊断；从终端直接调用 `paper-reed accounts/search`，不提供连接环境变量。
4. 正常退出并重启：无需重新添加邮箱，CLI 仍可读取。
5. fixture 更换密码，再重启触发真实认证失败；点击重新连接、填写新密码后恢复，账号数仍为一。
6. GUI 回复并保存草稿；CLI 读取同一草稿。再次正常重启，GUI 重开并发送；原生结果为 accepted/filed。
7. GUI 归档另一封邮件，CLI 的收件箱搜索同步体现变化。
8. fixture 核对整个流程 SMTP 实际提交恰好一次，正文为用户编辑的回复。

[源码启动结果](source-result.json) 与 [打包应用结果](result.json) 分别保存；截图为打包应用验证时的匿名测试邮箱。

- [空白接入页](connect-account.png)
- [连接错误与服务器表单](connection-error.png)
- [首次收件箱](inbox.png)
- [CLI 安装与诊断](installed-cli.png)
- [凭据失效与重新连接](reconnect.png)
- [发送与整理后](completed.png)

源码回归：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-first-run.py \
  --upstream research/.local/Mailspring
```

打包回归在同一命令后追加：

```sh
--app 'research/.local/Mailspring/app/dist/Paper Reed-darwin-arm64/Paper Reed.app/Contents/MacOS/Paper Reed'
```

本轮没有修改原生引擎或共享邮件写入契约。完整 TypeScript 检查与固定基线补丁重放结果见 [检查记录](patch-check.txt)。

## 边界

这是本机开发预览，尚未进行 Developer ID 签名、公证或公开安装包发布，仍有上游图标及非主路径文案。已证明普通 IMAP / SMTP 在本机服务上的首用、恢复与收发路径；没有验证真实服务商的 TLS、应用专用密码政策、OAuth、多账号长期同步或真实 Agent 写操作。SMTP 登录成功也不等于已验证全部投递权限，实际发送仍以原生结果为准。
