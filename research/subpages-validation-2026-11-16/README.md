# 通用、邮箱账号与快捷键设置

上一轮 `851b6ee` 已提交推送。本轮调整三个常用子页，沿用纸白、苇绿、轻量分隔和已选定的账号颜色边框方向。源码见 [0013 补丁](../patches/0013-settings-subpages.patch)，在桌面 0012 后应用，无需重新构建原生引擎。

| Before | After | Why |
| --- | --- | --- |
| 通用设置双栏密集混排，没有统一标题 | 标题与签名页对齐，单列分组，低频选项折叠 | 让阅读顺序和设置层级明确 |
| 通用控件修改后自动失焦 | Paper Reed 模式下保留焦点，原生控件按键与邮件快捷键隔离 | 可以连续通过键盘调整选项 |
| 账号列表大图标、粗色条、重复地址和大片空白 | 字母头像配颜色边框；名称、地址、服务商分层；明确添加／移除按钮 | 与邮件列表的账号辨识方式保持一致 |
| 别名列表空白、字段说明较弱 | 显示空状态，说明离开字段后保存；柔和输入框与行距 | 让可操作性和保存方式可见 |
| 快捷键双栏密集、没有查找入口，Tab 无法进入编辑 | 单列对齐、搜索／空结果、Enter 进入录入、Esc 或 Tab 取消 | 能快速查找并从键盘操作 |

## 已执行验证

使用真实 Electron、原生引擎、CLI/MCP 与本机 IMAP/SMTP 夹具。全程独立配置，loopback-only 沙箱，SMTP 提交数 **0**。没有修改真实邮箱、系统默认邮件客户端或系统启动项。

- 通用：Space 切换拼写选项，验证配置写入、焦点保留及恢复；阅读下拉选择写入配置。
- 账号：编辑名称并离焦保存；修改颜色、离焦保存，头像边框颜色同步；跨页面返回后名称仍然保留。
- 快捷键：方案切换写入配置；按操作名／内部命令／按键文字过滤；空结果清除；聚焦不开始录入、Enter 开始、Esc 取消不改文件；新组合键实际写入隔离配置的 `keymap.json`。
- 1440×900 与 900×700 实际截图；三页小窗口无横向溢出。
- TypeScript 检查通过。11 份桌面补丁从固定基线顺序应用后，44 个文件与测试源码逐字节一致。

测试中修正了搜索框 `width:100%` 加 padding 造成的横向溢出。快捷键保存检查最初错误限定修饰键序列，实际写入 `shift+mod+y`；改为比较等价的按键集合后通过，没有为测试改变产品的存储格式。

[实际窗口前后对照](index.html) · [测试结果](result.json) · [测试入口](../harness/check-settings-subpages.cjs)

```sh
PAPER_REED_SUBPAGES_CHECK=1 \
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --controls
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/check.py
```

`PAPER_REED_SUBPAGES_PHASE=before` 仅用于在修改前截取基线；不要在新源码上运行后把它当作旧版。

## 范围与未验证项

没有新增设置框架、存储或服务。仍使用 ConfigPropContainer、配置 schema、AccountStore、EditableList、原有快捷键解析与文件写入。账号排序继续由原列表处理，添加／移除仍调用原有回调；本轮未执行真实添加、移除、重连或清缓存。账号别名增删、异常连接、多账号排序和完整 VoiceOver 尚未回归。

本轮验证通用控件的配置写入，不等于已逐项验证其对实验工作台的行为效果。上游部分选项与 Paper Reed 实验布局的适配仍待后续核对；不能据此宣称所有上游功能已接入。快捷键命令名称及部分选项仍随原有语言系统显示，国际化尚未完整统一。外观、邮件规则、文件夹、邮件模板与 Agent 等子页尚未完成同等打磨；外观截图仅用于现状记录。整体仍是实验界面，未作为最终设计验收。
