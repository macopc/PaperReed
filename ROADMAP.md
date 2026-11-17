# Roadmap / 路线图

当前处于探索阶段。以下是推进条件，不是发布日期承诺，也不表示技术路线已经确定。

| 阶段 | 目标与完成条件 | 状态 |
| --- | --- | --- |
| 界面与工作流评审 | 当前界面暂作首版基线；后续用真实数据补充异常状态、可访问性与工作流验证 | 首版基线暂定 |
| 邮件核心设计 | 明确数据归属、UI / CLI 共用操作、草稿与发送语义；保持最小边界 | [方案已起草，待评审](design/MAIL-CORE.md) |
| 技术路线比较 | 比较同步、存储、UI、CLI 接入与维护成本；记录选型理由、许可约束和实验限制 | [首轮推荐已形成](design/TECH-CHOICE.md)，待真实闭环验证 |
| 最小真实闭环 | 用真实账号验证收信、回复草稿、发送、归档与 UI / CLI 状态一致；用实验结果决定技术路线 | [真实 Gmail 授权、收信、CLI／GUI 草稿与 HTTPS 发信已验证](research/gmail-integration-validation-2026-11-17/README.md)；真实整理与第二服务商待验证 |
| 界面接通邮件核心 | 以首版设计接通收件箱、会话／回复、写信，验证保存与冲突状态 | [实验接入与验证](research/ui-validation-2026-11-16/README.md)，尚待设计验收 |
| 多账号与多服务商 | 保持账号、草稿、操作与授权隔离；验证两个真实服务商同时收发 | [边界与推进顺序](design/MULTI-ACCOUNT.md)；[混合协议双账号检查通过](research/gmail-mailbox-validation-2026-11-17/README.md)，真实双服务商待验证 |
| 日用可靠性 | 验证离线恢复、凭据刷新、任务失败反馈、邮件渲染隔离、可访问性与性能 | 未开始 |
| macOS 分发 | 确定应用标识、系统支持范围、签名、公证、升级与安装流程 | [本机开发预览与独立应用身份](research/first-run-validation-2026-11-16/README.md)；正式分发未完成 |
| 内置 AI | 在稳定邮件操作与权限机制上增加可选摘要和写作辅助 | 后续考虑 |

优先级：基础邮件体验与外部 Agent 接入优先；内置 AI 后置。暂不扩展到移动端、自建邮件服务器、团队协作平台或插件市场。

## How decisions become final

Design review and technical evidence inform decisions; creating a repository, merging a prototype or passing checks does not approve the product design or select a stack. Record the rationale and unresolved risks in the relevant document when a decision is accepted.

The current interface is the first-version baseline. Real Gmail authorization, reading and one approved HTTPS send have been verified; mixed-account mailbox actions pass local protocol tests. Next, validate real mailbox organization and a second real provider, including sender identity and independent failures. Reliability and macOS distribution follow; built-in AI comes later. No release date is committed.
