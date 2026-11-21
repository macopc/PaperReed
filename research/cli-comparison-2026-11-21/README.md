# Paper Reed CLI 与 Himalaya 首轮对照

## 结果

两款 CLI 各通过 8/8 项检查。每次均仅有一封正确的回环 SMTP 提交，保留一封关联到正确原邮件的未发送回复。测试指定范围外的邮件旗标和文件夹没有变化。

| 会话 | 通过 | CLI 调用 | 帮助调用 | 非零退出 | 会话耗时 | 固定搜索中位数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1-himalaya | 4/4 | 22 | 9 | 0 | 57.8 s | 5.5 ms |
| 1-paper-reed | 4/4 | 26 | 11 | 0 | 65.5 s | 147.1 ms |
| 2-himalaya | 4/4 | 24 | 9 | 1 | 63.8 s | 5.3 ms |
| 2-paper-reed | 4/4 | 26 | 11 | 0 | 73.6 s | 146.3 ms |

两次合计 Paper Reed 52 次调用，Himalaya 46 次。各自合并 20 次固定搜索采样后的中位数为 146.6 ms 和 5.4 ms。Himalaya 的一次非零退出来自把邮箱地址当作账号别名，随后使用配置中的 work 成功重试。

[逐次结果和验收状态](results.json) · [共同任务提示](prompt.txt)

## 优化后复测

应用 0088 后，使用同一份任务提示、同一版本的 Codex CLI 和模型、同一合成邮箱重新执行四次会话。Paper Reed 和 Himalaya 各通过 8/8 项，每次均只有一封指定的回环 SMTP 投递，并留下一份正确关联的回复草稿。

| 会话 | 通过 | CLI 调用 | 帮助调用 | 会话耗时 | 固定搜索中位数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1-himalaya | 4/4 | 24 | 9 | 57.2 s | 5.4 ms |
| 1-paper-reed | 4/4 | 26 | 11 | 82.5 s | 50.4 ms |
| 2-himalaya | 4/4 | 23 | 9 | 63.5 s | 5.2 ms |
| 2-paper-reed | 4/4 | 26 | 11 | 73.6 s | 51.2 ms |

本轮每款 CLI 合并 20 次固定搜索采样，Paper Reed（系统 Node）为 **50.6 ms**，Himalaya 为 **5.3 ms**。整组任务中位数为 78.0 秒和 60.4 秒，包含模型推理及工具等待。

另以同一桌面服务交替执行前后版本，各保留 20 个样本，逐次核对两条搜索结果完全相同。桌面安装脚本生成的 launcher 从 **105.7 ms 降至 44.5 ms**，系统 Node 从 **146.3 ms 降至 49.8 ms**。

[复测结果](optimized-results.json) · [同场前后计时](paired-timings.json)

## 方法

- 在同一台 Apple M4 Mac（macOS 26.5.2） 上比较 Paper Reed 源码构建 `acabce3`（内置 CLI 报告 `0.0.1`）与 Himalaya `2.2.1` 官方 arm64 发行版。Paper Reed 使用真实桌面 MCP 和原生同步引擎。Himalaya 使用直连 IMAP/SMTP。
- 两款 CLI 各跑两次。每次给同版 Codex CLI 0.171.0、同一模型 gpt-6.1-sol、中等推理设置、同一份任务提示，一套从头建立的六封合成邮件。第一轮 Paper Reed 先跑，第二轮 Himalaya 先跑。
- 四项检查分别核对最新交期和确认码、指定邮件的已读和归档状态、回复草稿及其关联、恰好一次 SMTP 提交。整理结果由模拟 IMAP 服务的文件夹和旗标核对。草稿从 Paper Reed 的缓存数据库以及 Himalaya 的 IMAP Drafts 读取，核对正文、收件人及原邮件 Message-ID。发送由回环 SMTP 实收独立验证。
- 搜索耗时来自同一主题命中两封邮件的固定命令，每次会话前先预热一次，再测十次。计时含 CLI 进程启动和请求往返。Paper Reed 查已同步的本机索引。Himalaya 每次新建回环 IMAP 会话，夹具未实现 IMAP SORT，因此启用该版本自带的客户端排序。这个数字只反映本机小邮箱的端到端调用。
- 计数包含帮助、首次尝试、重试和结果核对。任务完成时间还包括模型推理和等待工具。两次会话只能描述本轮观察。大邮箱、真实云邮箱、增量同步时间、跨账号、并发修订和重启恢复都未纳入评分。
- 预跑发现原夹具用了含未加引号 `@` 的 From 显示名，且草稿评分读错了 Paper Reed 的持久字段。正式运行修正了夹具与验收，预跑结果不纳入统计。

## 复跑

需要准备好的 Paper Reed 源码桌面树（含已安装的 Electron/Playwright、已构建的 mailsync 和 0089 原生 CLI）、Node、Python 3、已登录的 Codex CLI 和 Himalaya 2.2.1。开发桌面的原生 CLI 可按 [CLI 构建说明](../cli/README.md#从研究源码运行维护者) 用 Go 1.23 或更新版本编译。用一个新目录接收隔离配置、原始命令轨迹、判分和搜索采样。

```sh
python3 research/cli-comparison-2026-11-21/run.py \
  --desktop /absolute/path/to/paper-reed-desktop \
  --himalaya /absolute/path/to/himalaya \
  --output "$(mktemp -d)" --reps 2
```

[Himalaya 发行页](https://github.com/pimalaya/himalaya/releases/tag/v2.2.1) · [Himalaya 配置示例](https://github.com/pimalaya/himalaya/blob/v2.2.1/config.sample.toml)


## 原生 CLI

0089 使用桌面安装流程生成的命令路径，每次重新启动 CLI，固定搜索分别采样 40 次。Himalaya 采用同版本二进制、同一合成邮件和连接方式。表中 P95 为排序后第 38 个值。

| CLI | P50 | P95 |
| --- | ---: | ---: |
| Paper Reed 安装命令 | 6.4 ms | 7.7 ms |
| Himalaya 2.2.1 | 5.3 ms | 5.5 ms |

第一轮原生实现保留了 shell 启动器，配对实验的中位数是 8.5 ms，直接执行同一原生二进制是 6.0 ms。桌面管理的符号链接省掉了这一步，连接文件仍保存在私有配置目录。采样在同一台 Mac 上进行，小邮箱结果主要反映进程启动和协议往返耗时。

完整任务重跑中，两款 CLI 各通过 8/8 项检查。四次会话各有一次回环 SMTP 投递，读取阶段均无副作用。

| 会话 | 通过 | CLI 调用 | 帮助调用 | 非零退出 | 会话耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1-himalaya | 4/4 | 22 | 9 | 0 | 54.9 s |
| 1-paper-reed | 4/4 | 26 | 11 | 0 | 67.7 s |
| 2-himalaya | 4/4 | 23 | 9 | 1 | 54.4 s |
| 2-paper-reed | 4/4 | 26 | 11 | 0 | 65.3 s |

只测固定搜索时，给上面的命令加上 `--timing-only --samples 40` 并将 `--reps` 设为 1。两个工具每次搜索均核对命中两封合成邮件。

[原生工作流逐次结果](native-results.json) · [原生搜索样本](native-timings.json)
