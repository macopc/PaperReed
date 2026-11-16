# 设置导航与签名版式

上一轮 `c9f4f9e` 已提交推送。本轮在同一实验桌面继续打磨设置导航与签名模板，源码见 [0012 补丁](../patches/0012-settings-navigation-templates.patch)，在 0011 后应用，不需要重编译引擎。

| Before | After | Why |
| --- | --- | --- |
| 设置使用一排彩色大图标，与邮件工作台割裂 | 固定宽度文字侧栏、轻量选中背景、明确返回邮件入口 | 减少视觉噪声，保留真实设置入口 |
| 切换设置页会强制把焦点移到内容 | 从侧栏切换时保留按钮焦点；内容滚回顶部 | 可连续使用键盘导航 |
| 五种签名模板只有微小缩略图 | 带版式名称、预览、选中边框的按钮；宽窗口三列、小窗口两列 | 让版式差别和当前选择可辨认 |
| 模板键盘事件被全局邮件快捷键截获 | 在导航与模板组内隔离 Enter／Space；预览内部链接不可聚焦 | 按钮保持原生键盘操作，预览不制造额外焦点 |
| HTML 模式容易与模板选择混淆 | 独立“自定义 HTML”选项，沿用替换前确认 | 保留已有签名与原有存储逻辑 |

复用 PreferencesUIStore、SignatureStore、原有五个模板及 RenderSignatureData。没有新增数据库、服务或第二套模板引擎。只在 `core.paperReed.enabled` 开启时使用新布局。

## 已验证

真实 Electron + 原生邮件引擎 + CLI/MCP，本机 IMAP/SMTP 测试服务，独立配置。最终运行使用 loopback-only 沙箱；SMTP 提交数为 0。实际截图见 [页面对照](index.html)，结果见 [result.json](result.json)。

- 从签名页进入真实 Agent 设置，再用 Enter 返回；焦点保留在设置导航，选中模板仍在。
- 自定义 HTML 切换模板：取消保留原数据，确认后更新模板；测试仅替代系统弹窗的响应，实际编辑逻辑和存储写入照常执行。
- 模板按钮 Enter 选择；姓名、职位进入实际 HTML；模板切到 HTML 保留内容，未修改的 HTML 可直接返回模板。
- 1440×900、900×700 实际窗口；侧栏、签名详情和模板网格无横向溢出。
- 返回邮件恢复原草稿，通过 CLI 读取仍有原正文及已插入的表情。
- 签名改名、默认账号、删除取消／确认、新建，以及表情搜索／空结果／键盘插入／Escape 回归通过。
- TypeScript 检查通过。10 份桌面补丁顺序应用到固定基线后，37 个文件与本轮测试源码逐字节一致。

```sh
PAPER_REED_SETTINGS_CHECK=1 PAPER_REED_NAVIGATION_CHECK=1 \
PAPER_REED_SETTINGS_OUTPUT="$PWD/research/navigation-validation-2026-11-16" \
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --controls
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/check.py
```

测试入口：[导航与模板](../harness/check-settings-navigation.cjs)、[签名与表情回归](../harness/check-settings-details.cjs)。调试时发现模板 Enter 被全局快捷键截走，已修复并重跑通过。返回邮件测试最初错误要求显示邮件列表；实际正确恢复了完整写信页，因此改为检查工作台入口、编辑器及保存正文。

## 边界

仍是实验界面。其他设置子页、上游订阅入口、部分高级签名字段与英文文案尚未按 Paper Reed 完整收敛；本轮只统一导航和签名版式选择。小窗口允许内容纵向滚动。五种版式是上游既有模板，尚未做跨邮件客户端的签名渲染验收；复杂 HTML、长地址、图片签名、多账号及 VoiceOver 完整流程仍待验证。
