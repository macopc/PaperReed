# 外观、邮件规则与文件夹设置

上一轮 `7eaaa93` 已提交推送。本轮源码见 [0014 补丁](../patches/0014-appearance-rules-folders.patch)，在桌面 0013 后应用，无需重编译引擎。

| Before | After | Why |
| --- | --- | --- |
| 外观混合了不完整适用于 Paper Reed 的上游主题与布局控件 | 当前固定样式预览、缩放、邮件正文深浅色、菜单栏状态分组 | 让用户明确每项调整的影响范围 |
| 规则空状态大图标，详情固定高度，新建即启用 | 安静的空状态、完整流式编辑、新规则默认暂停、显式启用开关 | 降低未编辑完整的规则被执行的机会 |
| 规则名称、条件与动作缺少清晰层级 | 规则列表与编辑区分层，名称直接编辑，常用条件与动作中文显示 | 方便理解、检查和修改规则 |
| 删除与整个收件箱处理的影响不明显 | 页内取消／确认，已有邮件处理放入独立折叠区 | 显示操作范围与后果 |
| 规则排序把账号内索引当作全局索引 | 将目标规则转换成全局插入位置 | 混有其他账号规则时仍能正确上移／下移 |
| 文件夹用途映射依赖自定义下拉，默认父目录缺少说明 | 按账号分组、原生选择器、清楚的用途和新账号默认路径说明 | 区分邮件用途映射与新账号的容器配置 |

沿用 ConfigPropContainer、MailRulesStore、ScenarioEditor、CategoryStore 与 ChangeRoleMappingTask；没有新增服务、存储或第二套规则引擎。新界面由 Paper Reed 开关控制，部分通用规则状态与排序修正同时适用于上游界面。

## 已验证

真实 Electron、CLI/MCP、原生引擎和本机 IMAP/SMTP 服务；独立配置，loopback-only 沙箱，SMTP 提交数 **0**。测试仅修改隔离邮箱中的文件夹映射、规则和一封测试邮件的星标。

- 外观：键盘调整缩放，配置和 Electron `webFrame.getZoomFactor()` 一致；恢复 100%；邮件正文模式和菜单栏状态配置写入、跨页面保留。
- 规则：新建默认暂停；名称、条件匹配方式、条件内容、动作保存；增加／移除条件；启用；上移／下移；删除取消／确认；删除后自动选中剩余规则。
- 排序：用另一账号 ID 的暂停规则作为前置夹具，验证当前账号规则的上移和下移。此夹具不启动第二个同步客户端，不等于完成真实多账号流程验收。
- 整个收件箱处理：取消后未启动处理；确认后，真实规则处理器给主题包含 `Design review` 的测试邮件加上星标，验证数据库中的邮件状态。
- 文件夹：通过真实选择器把垃圾邮件用途改为 `Paper Reed Review`，等待原生同步引擎更新后验证 CategoryStore 的路径与用途；跨页面仍保留。
- 默认父文件夹：离焦后保存到原配置键，说明其用于之后添加的账号。
- 1440×900 与 900×700 的实际截图；三页均无横向溢出。
- 等待原有 1 秒防抖后验证规则写入 `MailRules-V2`。初次检查过早读取而失败，已改为等待保存条件，没有改变产品的持久化机制。
- TypeScript 检查通过；12 份桌面补丁顺序应用到固定基线，49 个文件与测试源码逐字节一致。

[实际窗口前后对照](index.html) · [结果](result.json) · [验证脚本](../harness/check-organization-settings.cjs)

```sh
PAPER_REED_ORGANIZATION_CHECK=1 \
sandbox-exec -f research/harness/loopback-only.sb \
  research/.local/venv/bin/python research/harness/check-compose-handoff.py \
  --upstream research/.local/Mailspring --controls
npm --prefix research/.local/Mailspring run typecheck
python3 scripts/check.py
```

`PAPER_REED_ORGANIZATION_PHASE=before` 仅用于修改前截图。原始基线截图早于新测试文件夹的加入。

## 边界

外观整体仍固定为纸白与苇绿，本轮没有实现整套深色主题或其他工作台布局。正文模式与菜单栏选项验证了配置保存，尚未逐封验收复杂邮件的深色渲染或系统菜单栏图标。缩放则验证到实际 Electron 窗口。

文件夹页仍负责用途映射与默认容器路径，不新增远端文件夹创建／改名／删除功能。Gmail 固定系统标签的限制沿用原逻辑，本轮未接入真实 Gmail；首次同步、映射失败、特殊路径、数百个文件夹、真实多账号与 VoiceOver 完整流程尚待验证。

规则中的转发、移动、删除、含正文条件、停止长任务等未作为本轮真实执行验收；已保留原有处理逻辑和错误限制。整体仍是实验界面，不能视为所有规则动作和邮箱服务商均已通过验收。
