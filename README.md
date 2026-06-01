# CC_Pure — Claude Code 纯净留影版本

[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![GitHub License](https://img.shields.io/github/license/GhostDragon124/CC_Pure?style=flat-square)](./LICENSE)

> 基于 [claude-code-best (CCB)](https://github.com/claude-code-best/claude-code) v2.1.888 的纯净留影版本。
> 保留 CCB 全部功能，彻底移除所有 Anthropic 遥测上报。

---

## 🙏 致谢

本项目是 [claude-code-best](https://github.com/claude-code-best/claude-code) 的 fork，**衷心感谢 CCB 项目全体作者的卓越贡献**。他们完成了 Claude Code 的反编译/逆向还原这一不可思议的工作，让社区得以学习、研究和自由使用。

本项目在此基础上，进一步完成了 **Anthropic 遥测系统的彻底清除**，使其成为一个真正纯净的本地版本。

---

## 🔧 CC_Pure 的额外贡献

### 已清除的遥测系统

| 系统 | 原行为 | 处理方式 |
|------|--------|---------|
| **Datadog 日志** | 向 Anthropic Datadog 上报事件 | 默认端点已清空 (CCB) |
| **1P Event Logging** | 批量发送事件到 `api.anthropic.com` | 源码级永久禁用 |
| **GrowthBook 远程配置** | 启动时连接 Anthropic 拉取 feature flags | 初始化代码已移除 |
| **BigQuery Metrics** | 每 5 分钟上报 metrics | `isAnalyticsDisabled()` 永久返回 true |
| **OpenTelemetry** | 三方遥测指标/日志/追踪 | 初始化入口已守卫 |
| **Sentry** | 错误上报 | DSN 为空, no-op (CCB) |

### 修改的文件（4 个）

```
src/services/analytics/config.ts   — isAnalyticsDisabled() 永久返回 true
src/entrypoints/init.ts            — GrowthBook/1P/Telemetry 初始化已禁用
src/main.tsx                       — Analytics gate 初始化已禁用
src/utils/sinks.ts                 — Analytics sink 已禁用
```

所有修改均标注 `// CC_Pure:` 注释，原代码保留以供参考。

详细审计报告见 [`docs/telemetry-cleanup-audit.md`](docs/telemetry-cleanup-audit.md)。

---

## ⚡ 快速开始

### 环境要求

- 📦 [Bun](https://bun.sh/) >= 1.3.11

### 安装与运行

```bash
bun install
bun run dev      # 开发模式
bun run build    # 构建（产物输出到 dist/）
```

### 配置 API

在 REPL 中输入 `/login`，选择 **Anthropic Compatible** 配置第三方 API：

| 字段 | 说明 |
|------|------|
| Base URL | API 地址 |
| API Key | 认证密钥 |
| Haiku / Sonnet / Opus Model | 模型 ID |

配置保存到 `~/.claude/settings.json`。

---

## 📖 原 CCB 文档

- 在线文档：[ccb.agent-aura.top](https://ccb.agent-aura.top/)
- DeepWiki：[deepwiki.com/claude-code-best/claude-code](https://deepwiki.com/claude-code-best/claude-code)

---

## ⚖️ 许可证

本项目仅供学习研究用途。Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有。
