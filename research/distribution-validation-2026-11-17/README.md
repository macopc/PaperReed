# 配置完整的 macOS 预览包与登录收尾

此前接入范围调整已推送到 `05474a4`。本轮只补发行配置、版本归属和登录状态，不新增服务端、凭据系统或发布平台。

## 已实现

- 新增 [build-desktop.py](../../scripts/build-desktop.py)，用项目 Google Desktop client 配置构建 macOS 预览包。缺少文件立即停止；JSON 内容由现有构建脚本在开始耗时打包前解析一次。开发者仍可直接构建不含配置的实验包，正式预览入口则要求提供配置。
- 从本机此前的加密凭据恢复了项目 client ID / client secret，未导出邮箱 refresh token。恢复过程在隔离空账号配置及仅 loopback 网络下完成；原真实账号配置未改动。真实项目配置只在被 Git 忽略的本机路径和应用包中，不入源码仓库。
- 包内仅包含 Desktop client 配置，普通用户无需 JSON 或环境变量。安装包可公开的应用身份配置与用户保密的 refresh token 分开处理。
- 包版本改为 `0.1.0-preview.1`，记录 Paper Reed 仓库提交；未提交工作区带 `-dirty`，不把改动后的构建冒充纯提交版本。另保留上游版本用于追溯，仓库地址指向 PaperReed。
- Google 登录区分“请在浏览器完成授权”和“正在连接邮件服务器”；连接期间可取消，状态通过 `role=status` 提供。只有现有账号才显示“重新连接”，避免首次添加已填写邮箱地址时误导用户。

代码见 [0039](../patches/0039-configured-preview.patch)。本轮没有原生引擎修改。

## 构建

先按现有贡献指南准备补丁 checkout、依赖与原生 mailsync，然后执行：

```sh
python3 scripts/build-desktop.py \
  --google-client '/绝对路径/Google-Desktop-client.json' \
  --version 0.1.0-preview.1
```

默认生成 `.app` 和 ZIP。只需应用目录时加 `--skip-archive`。也可通过已有 `PAPER_REED_GOOGLE_CLIENT_FILE` 传入文件路径。版本及源码标识由该脚本传给现有构建器。

本轮生成的本机应用：`research/.local/Mailspring/app/dist/Paper Reed-darwin-arm64/Paper Reed.app`。使用独立测试 profile 检查，不覆盖用户安装的邮件客户端。本轮只生成 `.app`；ZIP 仍沿用上游打包步骤。

## 验证范围

- 完整 TypeScript 检查和生产授权／账号构建检查。
- 所有补丁从固定版本顺序重放，与测试源码比对。
- 配置缺失时在打包前停止。
- [check-distribution.cjs](../harness/check-distribution.cjs) 在真实应用包中读取元数据、核对项目配置且不输出其值；清除 OAuth 环境变量后点击登录，检查授权 URL 使用包内项目身份，并验证取消后关闭本机回调、不保存账号。浏览器打开被测试拦截，没有访问 Google 或代替用户授权。
- 实际打包应用的首次连接、密码失败、iCloud 设置、Gmail 引导、IMAP 重连、CLI、草稿恢复、发送和归档，使用仅 loopback 的邮件 fixture。

结果：配置与登录入口检查通过，见 [包验证结果](package-result.json)；打包版完整邮件／CLI 流程通过，fixture SMTP 恰好一封，见 [流程结果](workflow-result.json)。39 个补丁重放成功，109 个历史涉及的源码路径与测试 checkout 一致；类型检查、授权／账号构建检查和仓库静态检查均通过。

## 尚未完成

此包仍是本机开发预览，不是已签名、公证的公众发行版。当前构建未配置 Developer ID / 公证身份；现有上游更新器在 Paper Reed 模式禁用，独立安全更新发布流程尚未实现。Google 的应用发布验证和真实完整邮件授权仍属独立验收项，不阻塞产品开发。没有声称本轮完成了全部 UI、性能或可访问性验收。
