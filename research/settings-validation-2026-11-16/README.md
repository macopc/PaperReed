# 签名管理与表情选择器

基线 `64bac3a` 已提交推送。本轮继续沿用纸白、苇绿和轻量排版，源码见 [0011 补丁](../patches/0011-signature-settings-emoji.patch)。在桌面 0010 后应用，不需要重新构建原生引擎。

| Before | After | Why |
| --- | --- | --- |
| 签名管理依赖通用可编辑列表及小图标 | 左侧签名列表、右侧名称／默认邮箱／预览，文字新建和删除入口 | 明确当前编辑对象和默认应用范围 |
| 删除缺少页内解释 | 先说明已有草稿不受影响，再取消或确认 | 避免误删，不增加通用弹窗系统 |
| 表情依赖画布命中位置 | 真实按钮网格、分类选择、搜索和无结果提示 | 可聚焦、可用方向键与 Enter 选择 |
| 浮层焦点与外层快捷键冲突 | 保留正文选区，隔离选择事件并处理初始焦点 | 关闭不应代替插入，插入不应丢失光标位置 |

复用现有 SignatureStore、默认账号映射、签名模板及表情资源。新选择器通过 Paper Reed 开关启用；没有新增持久服务或另一套富文本引擎。搜索仍使用上游英文名称索引，入口明确标注，不声称支持中文搜索。

运行方式：

```sh
PAPER_REED_SETTINGS_CHECK=1 sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --controls
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/check.py
```

测试使用真实 Electron、CLI、MCP 和本机协议服务，签名为隔离配置中的测试数据；不连接真实邮箱。表情保存后通过 CLI 读取正文，保持原有文本与 `data-emoji-name` 内容。测试入口为 [check-settings-details.cjs](../harness/check-settings-details.cjs)，截图见 [实际页面](index.html)。

本轮未重做设置窗口外层导航。签名模板缩略图、HTML 编辑与部分高级字段仍沿用上游；尚未验证复杂签名、多账号真实配置、完整 VoiceOver、中文表情搜索或最近使用历史。这些页面仍是实验界面，不能视为最终设计验收。
