# 自编译引擎协议回归

2026-11-16 · 接续 [源码修复实验](engine-fix-validation.md)。**Xcode 阻塞已解除；补丁版原生引擎完整构建成功，六项邮件正确性协议场景通过。** 这支持继续采用 Mailspring 核心的验证路线，不等于完整 Paper Reed 客户端或真实邮箱接入已验收。

## 环境与产物

用户执行 Xcode 初始化后，本机 `xcodebuild -checkFirstLaunchStatus` 返回 0；`xcrun simctl list runtimes` 正常输出空列表，不再发生 CoreSimulator 加载错误。

- macOS 26.5.2 / arm64，Xcode 26.6，build 17F113。
- Mailspring 固定 `535f13dd463536f36728bce3efb4ae0d51ab3f19`；Sync 固定 `8681eae1d217d993e4d4dc7de17ae8b91fc3da49`，加 [原生修复补丁](patches/0001-mail-core-guards.patch)。本轮没有修改引擎修复逻辑。
- 从源码编译 MailCore、libetpan 和 mailsync，日志结尾为 `BUILD SUCCEEDED`，退出 0。存在上游弃用警告，不是无警告构建。
- 产物为 `research/.local/derived-data/Build/Products/Release/mailsync`，Mach-O arm64，Release / ad-hoc 签名；未做 Developer ID 签名、公证或安装包分发。
- 二进制 SHA-256：`0209cb33ad90b19b7f5a7dd1a2d63bb128a103bab5d27b4e328cbbd1f4901b4c`。

在 `research/.local/Mailspring/mailsync` 构建：

```sh
xcodebuild -scheme mailsync -configuration Release \
  -destination 'generic/platform=macOS' \
  -derivedDataPath ../../derived-data -jobs 4 \
  ONLY_ACTIVE_ARCH=YES ARCHS=arm64 CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=
```

上游构建流程执行 configure / 生成头文件。构建后观察到 `Vendor/libetpan/libetpan-config.h.in` 和 `Vendor/libetpan/build-windows/libetpan_version.h` 的变化（后者版本变为 1.9）；这些不属于手写产品补丁，也未作为 Paper Reed 修改提交。此次证明完整构建能运行，尚未证明独立机器上的逐字节可重现构建。

## 六项协议结果

所有场景使用**上述自编译二进制**、新建测试数据库、本地 fake:dovecot IMAP/SMTP，并在 `loopback-only.sb` 下执行。没有读取真实邮箱配置或向真实收件人发送邮件。

| 场景 | 实际结果 |
| --- | --- |
| 旧草稿保存 | 用户修订 3 保留；基于修订 1 的旧稿返回 `draft-conflict`；正文没有被替换 |
| 两个不同任务发送同一草稿 | 第一个获服务端接受，第二个被拒绝；SMTP 实际接收 1 次 |
| SMTP 正文提交前 SIGKILL | 重启后 SMTP 接收仍为 0；任务返回 `send-unknown`，不假报成功、不自动重发 |
| SMTP 已接收正文、最终确认前 SIGKILL | 重启后 SMTP 接收仍为 1；任务返回 `send-unknown`，不自动重发 |
| 已记录服务端接受、写入 Sent 副本前 SIGKILL | 重启后保持 `accepted`，副本为 `pending`；再提交同一草稿被拒绝，SMTP 总数为 1 |
| Sent 副本写入失败后正常重启 | 投递保持 `accepted`，副本明确为 `failed`；再次提交同一草稿被拒绝，SMTP 总数为 1 |

最后两项通过拦截本次 Python IMAP fixture 的 `APPEND` 处理实现：一项暂停响应并真实杀死引擎，另一项返回 IMAP `NO`。未编辑引擎数据库或伪造任务阶段。接受后崩溃场景在杀进程前确认任务已持久写入 `sendOutcome=accepted`。

机器可读结果见 [patched-engine-results.json](patched-engine-results.json)，记录二进制及原生补丁指纹。`paper_reed_contract_met` 只表示该行场景的断言通过，不代表整个产品契约通过。

复现全部六项，在 Paper Reed 根目录运行：

```sh
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-engine-contracts.py \
  --upstream research/.local/Mailspring \
  --binary research/.local/derived-data/Build/Products/Release/mailsync \
  --output research/.local --expect-fixed
```

本次先执行原四项，再分别执行新增的 `--case accepted-before-copy`、`--case copy-failure`；三次进程均退出 0。原始产物目录为 `research/.local/contracts-cmwr76ho`、`contracts-z65dhiaq`、`contracts-1bphebp2`，不入库。测试没有覆盖断电后存储持久性。

## 基础同步回归

另外用同一个自编译二进制执行上游 `baseline-initial-sync` 与 `client-task-move` 场景：**4 passed / 8 skipped / 187 deselected，45.81 秒**。通过项覆盖 fake:dovecot、fake:plain 的初始同步及移动／已读／星标操作；跳过项为本次未启动的真实 Dovecot / Cyrus 组合。

在 `research/.local/Mailspring/mailsync` 复现：

```sh
sandbox-exec -f ../../../harness/loopback-only.sb \
  ../../venv/bin/python -m pytest test --servers fake -n 0 \
  --mailsync ../../derived-data/Build/Products/Release/mailsync \
  -k 'baseline-initial-sync or client-task-move' --keep
```

本仓库 `scripts/check.py` 也通过：12 个页面产物保持同步、24 项 JS 语法检查以及 JSON / 本地 Markdown 链接有效。没有进行新的视觉验收。

## 后续范围

完整原生编译和这六项协议正确性已有运行证据。接下来优先完成 **CLI / GUI 共享草稿与发送结果契约**：显式修订、原操作查询、冲突交接、不确定结果核对，再做真实服务商授权与多账号实验。

仍未验收：完整桌面操作链、取消发送、附件字节不可变快照、冲突时关闭窗口的编辑保留、已接受邮件的副本自动补齐、Graph 故障注入、真实 OAuth、账号删除与记录生命周期。`pending` 副本目前只是诚实保留状态，没有宣称已自动修复。
