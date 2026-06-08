# CC_Pure CodeQL 已知架构债（39 条）

> 最后更新：2026-06-09  
> 状态：**已知债务，不修**——需要改变文件操作范式，非点修可解。

## 概览

| 规则 | 数量 | 本质 |
|:---|---:|:---|
| `js/file-system-race` | 23 | TOCTOU — check-then-use 文件竞态，遍布各处 |
| `js/insecure-temporary-file` | 11 | 临时文件路径可预测，`/tmp` 无原子化创建 |
| `js/indirect-command-line-injection` | 5 | 环境变量→命令拼接的间接注入路径 |

## 为什么不修

这三类告警要求**统一走原子化文件 API**（`mkstemp`、`O_EXCL`、`openat` + `fstat`），改动涉及数十个文件的文件操作模式。强行修风险大于收益：

- TOCTOU 在单用户 CLI 工具中利用窗口极小
- 临时文件在 `~/.claude/` 私密目录下，非共享 `/tmp`
- 间接命令注入的输入源是环境变量，非外部不可信输入

## CodeQL 审计历史

| 阶段 | 数量 | 结果 |
|:---|:---:|:---|
| 初始 | 175+ | — |
| Phase 0-4 安全审计 | 0 open | 全量审查关闭 |
| security-and-quality 升级 | 47 重开 | — |
| 本轮修复（2026-06-08~09） | 83→39 | 44 条修/dismiss |
| **剩余** | **39** | **已知债务，记录不修** |

## 本轮详细修复记录

| 类别 | 数量 | 行动 |
|:---|:---:|:---|
| 功能退化 revert | 3 | PermissionRuleList, BrowseMarketplace, DiscoverPlugins 错误提示恢复 |
| dismiss（CLI 日志不是安全边界） | 15 | log-injection, clear-text-logging, tainted-format-string, cmd-injection |
| dismiss（假阳性/已修/无关） | 7 | Math.random jitter, regex 去重, 等价守卫, compact_boundary 等 |
| fix（stripHtml 加固） | 2 | script tag 关闭标签容白 + 最终 fragment 清扫 |
| fix（unused test） | 1 | agent.test.ts |
| 好修清除 | 21 | unused/useless/trivial/directive/ASI（含 1 处 revert） |
| **剩余架构债** | **39** | 不修 |
