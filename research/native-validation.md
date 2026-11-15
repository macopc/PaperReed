# macOS 本机验证

2026-11-15 · 接续 [首轮选型](../design/TECH-CHOICE.md)。本轮验证使用完整上游源码与本机协议服务；没有登录真实邮箱，没有实现 Paper Reed 产品页面。

## 结论与服务边界

**邮件核心可以按纯 macOS 客户端路线推进，不需要 Paper Reed 自建邮件代理或业务服务端。** 本轮已有“不提供 Mailspring identity 服务、禁止外网访问，仍完成本机协议收发”的运行证据。但完整产品去除上游服务依赖、源码构建与真实服务商 OAuth 尚未通过。

- 收信、发信、服务端文件夹状态：客户端直接连接邮箱服务商。邮箱服务商的服务器仍必不可少；断网时只能使用缓存、编辑本机草稿及暂存操作。
- 草稿、缓存、搜索、置顶／稍后／本机标签：在 Mac 上处理和保存。当前基线的 `SyncbackDraftTask` 没有远端回写阶段，本机草稿不意味着跨设备续写。
- CLI / MCP：连接桌面应用的 loopback 接口，上游监听 `127.0.0.1`。它是本机进程间通信，不是需要部署的公网服务；首版仍要求桌面核心运行。
- Gmail / Microsoft 授权：已有代码在本机向服务商 token endpoint 换取、刷新 token；Paper Reed 需要自己的 OAuth 注册、回调和发布验证。这里是源码证据，尚未用 Paper Reed 注册完成实测。
- 发布更新：需要应用包的分发位置，可以采用托管发布设施；不需要因此建立保存用户邮件的业务后台。本轮未验证更新、签名或公证。
- 外部 Agent：邮件操作入口在本机；Agent 选择的模型可能运行在云端。这与 Paper Reed 是否需要自建服务端是两个问题，不承诺使用外部 Agent 时全部计算离线完成。

相关源码：[本机 MCP 监听](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/internal_packages/mcp-server/lib/mcp-http-server.ts)、[OAuth 刷新](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/NetworkRequestUtils.cpp)、[本机草稿写入与远端空分支](https://github.com/Foundry376/Mailspring-Sync/blob/8681eae1d217d993e4d4dc7de17ae8b91fc3da49/MailSync/TaskProcessor.cpp)。

## 环境与来源

| 项目 | 本轮使用 |
| --- | --- |
| 平台 | macOS，arm64；Xcode 26.6 / Apple clang 21.0.0 |
| JS 工具链 | Node 24.15.0，npm 11.12.1；上游固定 Electron 44.9.1 |
| 协议 harness | 隔离 Python 3.12.13；pytest 9.2.0、pytest-xdist 3.8.0、PyYAML 6.0.3 |
| Mailspring 完整 checkout | `535f13dd463536f36728bce3efb4ae0d51ab3f19` |
| Sync 完整子模块 | `8681eae1d217d993e4d4dc7de17ae8b91fc3da49` |
| 实验目录 | `research/.local/`，已忽略；与原研究快照和产品设计分开 |

本轮没有修改上游应用或引擎源码。上游 `postinstall` 会执行 app 目录的 `npm install / dedupe`，导致实验 checkout 的 `app/package-lock.json` 出现变化；这不是严格锁文件重现构建，后续构建验证需要处理。协议实验用的是下面的预编译引擎，不是本轮编译产物。

## 源码构建：环境阻塞，不计通过

从完整源码执行了：

```sh
xcodebuild -scheme mailsync -configuration Release \
  -destination 'generic/platform=macOS' \
  -derivedDataPath ../../derived-data -jobs 4 \
  ONLY_ACTIVE_ARCH=YES ARCHS=arm64 CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=
```

编译前退出，code 70：Xcode 的 `IDESimulatorFoundation` 无法加载缺失的 `/Library/Developer/PrivateFrameworks/CoreSimulator.framework`。尝试官方首次初始化命令；管理员执行需要密码，安全输入已取消，未继续请求或执行提权。**尚未验证这份 C++ 源码可构建，也不能据此判断源码本身构建失败。**

客户端依赖安装完成，`npm run typecheck` 退出 0。Electron 二进制需在解除实验网络限制的安装阶段先下载，运行实验时再限制网络；仅 `npm rebuild electron` 不保证此版本的延迟下载已完成。

## 引擎运行：预编译产物，8 个场景实例通过

使用上游安装脚本对应的 [固定提交路径产物](https://mailspring-builds.s3.amazonaws.com/mailsync/8681eae1/osx/mailsync.tar.gz)。这是上游提供的 arm64 / x86_64 通用二进制，不是对可重现构建的证明。

```text
SHA-256 mailsync.tar.gz
b6cb06025fdc6ddc69471759349dc4ad91f0c1c4d7b3be4fb81b3ef0d72c2ec5
SHA-256 mailsync
cbc1b2ac4cd21f98df7c14759d2145bc17888a83ecab5ff0c3005ddac4776448
```

实验通过 [loopback-only.sb](harness/loopback-only.sb) 限制外连，仅允许本机连接。独立 socket 探针先验证本机连接成功、外网连接得到 `PermissionError`。整个 Python harness 及子进程继承限制；使用 `identity = null`，`IDENTITY_SERVER` 指向本机不可用地址。引擎日志明确出现 `Metadata sync disabled, not logged in.`。

| 场景 | 结果与观察 |
| --- | --- |
| 初次同步，fake:dovecot / fake:plain | 2 项通过；多文件夹、已读／星标与附件邮件进入本地库，后续同步保持一致 |
| 客户端移入 Archive、星标、未读，两个 fake profile | 2 项通过；本地与测试服务器状态一致 |
| 发送给测试收件人及自己，两个 fake profile | 2 项通过；SMTP 接收数量、已发送副本及自收副本符合场景断言 |
| 发送后、自收副本到达前重启 | 1 项通过；恢复状态与规则通知满足上游场景断言；不代表发送中崩溃已解决 |
| 本机草稿保存与草稿删除 | 单独 1 项通过；本机草稿未上传，远端已有草稿与本机草稿可分别处理 |

第一组结果为 **7 passed / 10 skipped / 182 deselected，114.42 秒**。10 项跳过的是 Dovecot / Cyrus 实际服务进程组合，本次只选 fake；另单独执行草稿场景通过。这里运行了真实引擎与真实 IMAP / SMTP 协议连接，但服务端是可控的本机模拟实现；不能称为 Gmail、Outlook、iCloud 接入通过。

复现时先准备相同 checkout、上述二进制到 `Mailspring/app/mailsync`，以及 harness Python 依赖。在 `research/.local/Mailspring/mailsync` 执行：

```sh
sandbox-exec -f ../../../harness/loopback-only.sb \
  ../../venv/bin/python -m pytest test --servers fake -n 0 \
  -k 'baseline-initial-sync or send-draft or client-task-move or rules-ready-across-restart' --keep

sandbox-exec -f ../../../harness/loopback-only.sb \
  ../../venv/bin/python test/run.py test/scenarios/synced-draft-destroy.yaml \
  --server fake:dovecot --keep
```

原始日志与测试数据库在忽略目录 `research/.local/` 内，不提交上游源码、二进制或数据库。上述实验不覆盖共享草稿冲突控制、CLI 去重、发送中断后 `unknown`、真实 OAuth 或 macOS 发布。

## 桌面启动：受限烟测通过，不是发布验收

从源码启动 Electron，使用新建的隔离配置目录，不设置上游用于跳过真实同步等待的 `PLAYWRIGHT` 模式。观察到数据库迁移返回无错误，并在 DOM 中读到 `Welcome to Mailspring / Get Started`；没有添加邮箱。外网被阻止时，上游更新检查报权限错误，欢迎页仍能打开。

首次尝试遇到两个测试环境因素：宿主传入的 `ELECTRON_RUN_AS_NODE` 需从启动环境移除；外层 macOS 网络沙箱与 Chromium 子进程沙箱组合导致 GPU 启动失败。烟测保留外层网络限制，仅为该次实验加 `--no-sandbox`。**没有修改产品配置，也没有验证生产环境的 Chromium 沙箱、账号界面或邮件渲染。** 上游禁用了页面 eval，脚本通过 CDP DOM 读取文本，没有为测试修改这项限制。

在完整 Mailspring checkout 目录运行：

```sh
sandbox-exec -f ../../harness/loopback-only.sb \
  node ../../harness/check-desktop-start.cjs
```

脚本使用上游安装的 Electron / Playwright，启动新配置目录，读取窗口后关闭应用，输出 `research/.local/electron-smoke.json`。它只是启动检查，未测试 Paper Reed 的设计和完整 UI / CLI 闭环。

## 上游产品服务仍需处理

基础引擎不需要上游账号，不代表原客户端已完全去除上游服务：

- 初次引导中的 authenticate 页面加载上游 identity 网页；即使支持跳过，也需要替换为本机账号接入流程。
- 元数据 worker 无 identity 时退出；本机标签／稍后需要自己的本机保存路径，不能误走上游元数据同步。
- 更新 feed、错误上报和部分诊断仍引用上游域名；Paper Reed 需明确替换或移除。

这些是客户端分支的改动范围，不构成我们必须搭建一套替代云后台的理由。[引导源码](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/internal_packages/onboarding/lib/page-authenticate.tsx)、[更新源码](https://github.com/Foundry376/Mailspring/blob/535f13dd463536f36728bce3efb4ae0d51ab3f19/app/src/browser/autoupdate-manager.ts)

## 下一步

仍按原路线继续：源码构建环境恢复后，用自己构建的引擎复跑这些场景；随后加入草稿原子修订校验、持久发送结果和请求去重的最小实验，再进行专用真实邮箱的授权与收发验证。当前不需要提供邮箱密码；本轮没有完成任何真实邮箱授权。
