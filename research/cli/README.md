# 实验 CLI

这是 Paper Reed 共用接口实验，不是可独立安装的邮件客户端。需要运行应用了 0001–0003 补丁的 Mailspring 桌面实例，并启用其本机 MCP。SDK 使用该 checkout 的已有依赖。

```sh
export PAPER_REED_UPSTREAM="/absolute/path/to/patched/Mailspring"
export PAPER_REED_MCP_URL="http://127.0.0.1:2587/mcp"
export PAPER_REED_TOKEN_FILE="/absolute/path/to/local-token-file"
```

token 文件内容为桌面 MCP 设置中的令牌；建议文件权限为 `600`。不把令牌放到命令行或提交到仓库。本轮没有自动创建真实配置或读取用户现有令牌。

从 Paper Reed 仓库运行，JSON 通过 stdin 传入，结果写 stdout；工具失败退出码为 1，客户端／连接错误写 stderr。只允许 `127.0.0.1` HTTP 端点，禁止跟随重定向。

```sh
node research/cli/paper-reed.cjs draft-get <<'JSON'
{"accountId":"test-account","draftId":"draft-message-id@example.test"}
JSON

node research/cli/paper-reed.cjs draft-update <<'JSON'
{"accountId":"test-account","draftId":"draft-message-id@example.test","expectedRevision":3,"changes":{"body":"修改后的正文"}}
JSON

node research/cli/paper-reed.cjs operation-get <<'JSON'
{"accountId":"test-account","operationId":"pr-send-<returned-id>"}
JSON
```

`draft-send` 输入为 `{accountId,draftId,expectedRevision,requestId}`。调用前需要发送权限；`requestId` 必须在重试间保持一致。结果可能只是 `queued` 或 `pending-admission`，随后查询 operation；看到 `unknown` 不自动换请求重发。`draft-create` 输入同现有 `create_draft` 工具，但 CLI 强制显式 `accountId`。

正文沿用草稿的 `plaintext` 格式，不能用正文更新操作切换格式。当前编辑接口只修改主题和正文，其他字段保留。完整范围和已验证／未验证事项见 [共用接口记录](../shared-core-validation.md)。
