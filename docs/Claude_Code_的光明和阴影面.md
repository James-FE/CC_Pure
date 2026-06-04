# Claude Code 的光明和阴影面

> **副标题：** Anthropic 遥测系统的逆向工程、纵深防御与自用改造
> 
> **作者：** James Feng（基于 CC_Pure 代码库逆向分析，2026年6月）
> 
> **标签：** `逆向工程` `遥测` `隐私` `GrowthBook` `OpenTelemetry` `数据分析`

---

## 目录

1. [前言：为什么要写这篇文章](#1-前言)
2. [光明面：一套工业级的数据工厂](#2-光明面)
3. [阴影面：数据去哪了](#3-阴影面)
4. [解剖：遥测系统的五层架构](#4-解剖)
5. [防御：我们做了什么](#5-防御)
6. [为己所用：如何让这套系统服务于你](#6-为己所用)
7. [附录：事件词典](#7-附录)

---

## 1. 前言

Claude Code（内部代号 "tengu"）是 Anthropic 的终端 AI 编程助手。它不仅仅是一个命令行工具——它是一套完整的**数据采集和分析基础设施**。每当你输入一个命令、调用一个工具、触发一次 API 请求，几十个遥测事件在后台被捕获、采样、路由和上报。

本文基于对 **CC_Pure**（Claude Code 反编译还原项目）的深度代码审计，完整拆解这套遥测系统：

- 它收集了什么？
- 数据流向了哪里？
- 我们如何发现并防御？
- 更重要的是，**我们如何把它变成自己的利器**？

> **核心结论：** Anthropic 的遥测基础设施本身就是一套值得学习的工业级数据工程范例。我们不需要摧毁它——我们需要**接管它**。

---

## 2. 光明面

### 2.1 工程设计的精妙之处

Claude Code 的遥测系统不是简单的埋点+上报。它是一套分层架构：

```
logEvent()
  ├── 本地 JSONL 写入（我们加的防御层）
  ├── 事件队列（sink 未初始化时的缓冲）
  ├── GrowthBook 动态采样（云端控制的抽样引擎）
  ├── Datadog 监控（运维告警）
  └── 1P 事件上报（Anthropic 内部 BigQuery 分析）
```

**亮点 1：零依赖入口设计**

`logEvent()` 函数（`src/services/analytics/index.ts`）本身没有任何模块级依赖。所有事件先进入队列，等 `attachAnalyticsSink()` 在应用初始化时被调用后才真正路由到后端。这个设计避免了循环依赖，也让测试变得极其容易。

```typescript
// 精妙：零依赖的入口
export function logEvent(eventName, metadata) {
  // ① 本地写入（我们的注入点）
  writeLocalEvent(eventName, metadata)
  // ② 如果 sink 未就绪，入队；否则直接发送
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: false })
    return
  }
  sink.logEvent(eventName, metadata)
}
```

**亮点 2：GrowthBook 动态实验平台**

整个项目的 feature flag 系统建立在 GrowthBook 之上。这不是简单的 `if (feature_enabled)` —— 它是一个完整的 A/B 实验平台：

- **远程评估（remote eval）：** 服务器预先计算每个 feature 的值，客户端直接使用，无需本地规则引擎
- **磁盘缓存 + 会话内刷新：** 首次获取后写 `~/.claude.json`，后续进程启动用缓存，会话期间通过 `onGrowthBookRefresh` 推送更新
- **实验曝光追踪：** 每个被访问的 feature 自动记录实验分配事件到 1P 事件管道
- **动态配置（JSON config）：** 不仅是开关，还支持复杂的 JSON 配置（如事件采样率、批处理参数、sink kill switch）

`src/services/analytics/growthbook.ts` 文件高达 **1256 行**，处理了远程评估响应格式的 workaround、env-var override、config override、刷新信号机制等细节。

**亮点 3：ToolSearchTool —— RL 数据工厂的核心**

`ToolSearchTool` 不仅是一个工具搜索功能，它是一台**强化学习数据收集机器**：

```typescript
// 搜索评分权重（精确调优的参数）
if (parsed.parts.includes(term)) {
  score += parsed.isMcp ? 12 : 10    // MCP 工具名精确匹配权重更高
} else if (parsed.parts.some(part => part.includes(term))) {
  score += parsed.isMcp ? 6 : 5      // 部分匹配
}
// searchHint 匹配
score += 4
// 描述匹配
score += 2
```

每一次搜索都上报 `tengu_tool_search_outcome` 事件，包含：
- `query`：用户的搜索词
- `queryType`：`select` 或 `keyword`
- `matchCount`：命中数量
- `totalDeferredTools`：延迟工具总数
- `hasMatches`：是否有命中

这套数据让 Anthropic 能够**量化分析模型如何使用工具**，从而持续优化工具描述、搜索算法和评分权重。

**亮点 4：多层 PII 防护**

代码中随处可见隐私保护设计：

- `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 类型标记——强制开发者验证不上传代码/路径
- `sanitizeToolNameForAnalytics()` —— MCP 工具名（可能暴露用户配置）被替换为 `mcp_tool`
- `stripProtoFields()` —— PII 标记字段只在 1P 特权列中，不进入通用 Datadog
- `getFileExtensionForAnalytics()` —— 只上传文件扩展名，不上传完整路径
- `getUserBucket()` —— 用户 ID 哈希分桶，去匿名化计数但不暴露身份

### 2.2 事件体系全景

通过代码审计，我们统计出 **190+ 处 `logEvent()` 调用**，分布在 52 个文件中。主要事件类别：

| 类别 | 事件数 | 代表事件 |
|------|--------|---------|
| API 查询 | ~20 | `tengu_query_error`, `tengu_api_success`, `tengu_token_budget_completed` |
| 工具使用 | ~15 | `tengu_tool_search_outcome`, `tengu_bash_tool_used` |
| 权限决策 | ~10 | `tengu_tool_use_granted`, `tengu_tool_use_rejected` |
| 认证/OAuth | ~15 | `tengu_oauth_success`, `tengu_oauth_token_refresh_failure` |
| 会话生命周期 | ~10 | `tengu_started`, `tengu_exit`, `tengu_init` |
| 压缩/内存 | ~5 | `tengu_auto_compact_succeeded`, `tengu_orphaned_messages_tombstoned` |
| 实验/A/B | ~8 | `tengu_willow_mode`, GrowthBook assignment |
| Bridge/Remote | ~15 | `tengu_bridge_message_received`, `tengu_ws_transport_reconnected` |
| 迁移 | ~8 | `tengu_opus_to_opus1m_migration` |
| 遥测自监控 | ~3 | `analytics_sink_attached` |

### 2.3 数据工厂：四线并行

Anthropic 实质上运行着**四条独立的数据管道**：

1. **Datadog（运维）**：白名单制，只发送 ~40 种预定义事件到 Datadog，用于 API 错误率、OAuth 故障率等 SRE 告警
2. **1P Event Logging（分析）**：基于 OpenTelemetry SDK Logs，**所有事件**通过 `/api/event_logging/batch` 上报到 Anthropic 的 BigQuery，是核心分析管道
3. **GrowthBook（实验）**：Feature flag 赋值 + 实验曝光事件，独立上报，用于 A/B 测试结果评估
4. **Customer OTLP（客户遥测）**：可选的企业客户 OTLP 导出（metrics/logs/traces），由 `CLAUDE_CODE_ENABLE_TELEMETRY` 控制

---

## 3. 阴影面

### 3.1 数据收集的广度

让我们诚实地审视：Claude Code **实际收集了什么**？

```
每次启动：
  ✓ 操作系统版本、终端类型、包管理器列表
  ✓ Git 仓库远程 URL 的哈希（"rh" 字段）
  ✓ 用户订阅级别（免费/Pro/Max/Team/Enterprise）
  ✓ 是否为 CI 环境、GitHub Action 类型

每次 API 查询：
  ✓ 使用的模型名称、beta 列表
  ✓ token 消耗量、上下文窗口大小
  ✓ 是否触发了 fallback 模型
  ✓ 查询前后的 attachment 对比

每次工具调用：
  ✓ 工具名称、是否成功
  ✓ 文件扩展名（不是路径，但足以推断工程类型）
  ✓ Bash 命令类型（diff/grep/sed 等）
  ✓ 权限决策（always allow / reject / ask）

每次会话：
  ✓ 启动次数、使用时长
  ✓ 压缩频率、孤儿消息数量
  ✓ KAIROS（后台 agent）活跃状态
```

### 3.2 技术上的透明度

Anthropic 并不是在偷偷做这件事。代码中的设计模式表明：

1. **所有遥测都在 `src/services/analytics/` 下集中管理**，模块边界清晰
2. **隐私分级明确**（`AnalyticsMetadata_I_VERIFIED_...` 类型标记）
3. **提供了 opt-out 机制**（`DISABLE_TELEMETRY` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`）

但从"后门"到"数据工厂"的距离并不远。这一套基础设施如果被滥用（或遭遇供应链攻击），可以轻松变成：

- 代码片段收集器（绕过文件路径截断，直接上传内容）
- 用户行为画像（通过 token 消耗模式推断工作习惯）
- 工程结构嗅探（通过文件扩展名统计推断技术栈）

### 3.3 我们发现的"异常"

在 CC_Pure 的代码审计中，我们注意到几个不寻常的地方：

1. **`USER_TYPE === 'ant'` 条件分支：** 代码中有 **50+ 处**检查用户是否为 Anthropic 内部员工。内部版本能看到额外的调试信息、工具（ConfigTool, TungstenTool, REPLTool）、错误日志。这不是安全问题，但说明"内部版本"和"外部版本"的差异比文档披露的更大。

2. **ToolSearchTool 的 RL 评分权重：** `12/10/6/5/4/3/2` 的精细评分体系不是手工调整的——它暗示着**持续的 A/B 实验和 RL 优化**在背后运行。

3. **GrowthBook 动态配置的深度：** 不仅是 feature flag，还包括事件采样率、批处理大小、sink kill switch、甚至 `tengu_max_version_config` 这种远程杀死特定版本的开关。

---

## 4. 解剖：遥测系统的五层架构

### 第一层：事件生成（Event Generation）

事件在代码各处通过 `logEvent('event_name', metadata)` 生成。事件名称遵循 `tengu_<领域>_<动作>` 的命名规范。

```typescript
// 典型的事件生成点
logEvent('tengu_tool_search_outcome', {
  query, queryType, matchCount, totalDeferredTools, maxResults, hasMatches
})
```

metadata 的类型约束是 `{ [key: string]: boolean | number | undefined }` —— 禁止传递字符串，避免意外上传代码。

### 第二层：事件增强（Event Enrichment）

在进入 sink 之前，每个事件被 `getEventMetadata()` 增强，注入：

- **会话上下文：** sessionId, clientType, isInteractive
- **环境上下文：** 操作系统、终端、包管理器、CI 检测
- **模型信息：** 当前使用的模型、betas、provider
- **用户信息：** userType, subscriptionType, userBucket
- **进程指标：** RSS, heapUsed, cpuUsage（仅在 Datadog 路径）

`src/services/analytics/metadata.ts` 长达 **966 行**，是这个增强引擎的核心。

### 第三层：采样与过滤（Sampling & Filtering）

事件在发送前经过多层过滤：

```
1. isAnalyticsDisabled()  ← 总开关
   ├── NODE_ENV === 'test'?
   ├── 3P provider (Bedrock/Vertex/Foundry)?
   └── isTelemetryDisabled()?
       ├── DISABLE_TELEMETRY?
       └── CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?

2. shouldSampleEvent()  ← GrowthBook 动态采样
   └── tengu_event_sampling_config（JSON 配置，按事件名设置采样率）

3. isSinkKilled('datadog' | 'firstParty')  ← 按 sink 单独杀死
   └── tengu_frond_boric GrowthBook 配置

4. 对 Datadog 额外：白名单（DATADOG_ALLOWED_EVENTS）+ 非生产环境跳过
```

### 第四层：事件路由（Event Routing）

`logEventImpl()` 在 `sink.ts` 中将事件分发给两个后端：

```
logEventImpl(eventName, metadata)
  ├── shouldTrackDatadog()? → trackDatadogEvent()
  │     └── POST https://http-intake.logs.datadoghq.com/api/v2/logs
  │         批次大小: 100, 刷新间隔: 15s
  │
  └── logEventTo1P() → FirstPartyEventLoggingExporter
        └── POST https://api.anthropic.com/api/event_logging/batch
            批次大小: 200 (可配置), 刷新间隔: 10s (可配置)
```

### 第五层：持久化与重试（Persistence & Retry）

1P 事件导出器（`firstPartyEventLoggingExporter.ts`，**806 行**）具有工业级可靠性：

- **磁盘持久化：** 发送失败的事件写入 `~/.claude/telemetry/1p_failed_events.{sessionId}.{batchId}.json`
- **二次退避重试：** `baseDelay * attempts²`，最长达 30s，最多 8 次
- **跨进程恢复：** 启动时重试之前会话的失败文件
- **分级失败处理：** 一个批次失败 → 短路剩余批次 → 全部入队重试
- **并发安全：** 追加写（append）而非全量写，避免覆盖并发事件

---

## 5. 防御：我们做了什么

### 5.1 纵深防御策略

我们的防御策略不是"关掉遥测"——那样会丢失学习这套系统的机会。而是**在遥测管道的最前端插入一个本地分支**：

```
                  logEvent()
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
[本地 JSONL]     [Datadog]     [Anthropic 1P]
  永远执行        可被关闭        可被关闭
  自己的数据      运维数据        BigQuery 分析
```

**关键改动（仅 3 个文件，不改任何工具代码）：**

1. **`src/services/analytics/localSink.ts`**（54 行新文件）
   ```typescript
   // 将事件追加写入 ~/.claude/local_analytics.jsonl
   export function writeLocalEvent(eventName, metadata) {
     const line = JSON.stringify({
       ts: new Date().toISOString(),
       event: eventName,
       ...metadata,
     }) + '\n'
     fs.appendFileSync(LOCAL_ANALYTICS_FILE, line, 'utf-8')
   }
   ```

2. **`src/services/analytics/index.ts`**（在 `logEvent()` 入口处插入 3 行）
   ```typescript
   // 在所有上游 sink 之前执行
   const { writeLocalEvent } = require('./localSink.js')
   writeLocalEvent(eventName, metadata)
   ```

3. **`scripts/analyze_analytics.py`**（分析脚本）

### 5.2 为什么这个方案优于直接关掉遥测

| 方案 | 优点 | 缺点 |
|------|------|------|
| `DISABLE_TELEMETRY=1` | 简单，一键关闭 | 丢失所有数据，学不到东西 |
| 直接删除 analytics 代码 | 彻底 | 破坏代码结构，每次更新需重新修改 |
| **我们的方案：前端分叉** | 保留完整基础设施，数据归自己 | 需额外 200 行代码 + 分析工具 |

### 5.3 .gitignore 防护

```gitignore
# Local analytics data (never upload)
*.jsonl
.claude/
```

确保本地遥测数据绝不会被意外提交到仓库。

---

## 6. 为己所用

### 6.1 本地数据文件

`~/.claude/local_analytics.jsonl` —— 一行一个 JSON 事件：

```json
{"ts":"2026-06-03T10:15:23.456Z","event":"tengu_started","sessionId":"abc123"}
{"ts":"2026-06-03T10:15:24.789Z","event":"tengu_bash_tool_used","toolName":"Bash"}
{"ts":"2026-06-03T10:15:25.012Z","event":"tengu_api_success","model":"claude-sonnet-4-20250514"}
```

### 6.2 分析脚本

```bash
# 查看事件统计报告
python3 scripts/analyze_analytics.py

# 实时追踪事件流
tail -f ~/.claude/local_analytics.jsonl

# 搜索特定事件
grep "tengu_query_error" ~/.claude/local_analytics.jsonl | python3 -m json.tool

# 按天统计使用次数
grep "tengu_started" ~/.claude/local_analytics.jsonl | wc -l
```

### 6.3 你能分析什么

| 分析维度 | 数据来源 | 回答的问题 |
|---------|---------|-----------|
| 工具使用频率 | `tengu_tool_use_*` | 我最常用什么工具？Bash 占比多少？ |
| 模型 fallback 率 | `tengu_model_fallback_triggered` | 我的 API 稳定性如何？ |
| 上下文压缩频率 | `tengu_auto_compact_succeeded` | 我的对话是否经常超出窗口？ |
| API 错误类型 | `tengu_query_error` + `http_status` | 什么类型的错误最多？ |
| 会话时长/频率 | `tengu_started` / `tengu_exit` | 我每天用多少次？每次多久？ |
| 工具搜索行为 | `tengu_tool_search_outcome` | 模型是否能正确找到工具？ |

### 6.4 进阶：扩展分析

因为本地 JSONL 包含所有事件的完整 metadata，你可以构建：

1. **个人使用画像：** 统计最常用的模型、工具组合、操作模式
2. **成本分析：** 结合 token 消耗事件，估算每日 API 费用
3. **效率仪表板：** Pandas/Streamlit 可视化，实时监控 CCB 使用
4. **异常检测：** 监控错误率突增、fallback 异常等

### 6.5 从 Anthropic 学习的最佳实践

这套遥测系统本身就是一个教科书级的案例：

1. **零依赖入口 + 延迟绑定：** `logEvent()` 无依赖，sink 通过 `attachAnalyticsSink()` 延迟注入 —— 适合任何需要插拔式后端的系统
2. **多层过滤链：** 总开关 → 采样 → sink kill switch —— 灵活且可远程控制
3. **磁盘兜底 + 指数退避：** 即使网络失败也不丢事件
4. **隐私类型系统：** TypeScript 的 `never` 类型 + 标记模式强制代码审查
5. **GrowthBook 集成模式：** 将 feature flag 变成数据采集工具

---

## 7. 附录：事件词典

以下是代码审计中发现的全部遥测事件（部分代表性事件）：

### API & Query

| 事件名 | 描述 |
|--------|------|
| `tengu_query_error` | API 查询错误 |
| `tengu_api_success` | API 调用成功 |
| `tengu_model_fallback_triggered` | 触发模型降级 |
| `tengu_max_tokens_escalate` | Token 上限触发 |
| `tengu_token_budget_completed` | Token 预算耗尽 |
| `tengu_query_before_attachments` | 查询前 attachment 状态 |
| `tengu_query_after_attachments` | 查询后 attachment 状态 |
| `tengu_streaming_tool_execution_used` | 流式工具执行启用 |
| `tengu_streaming_tool_execution_not_used` | 流式工具执行未启用 |
| `tengu_post_autocompact_turn` | 自动压缩后的对话轮次 |

### 工具使用

| 事件名 | 描述 |
|--------|------|
| `tengu_tool_search_outcome` | 工具搜索结果（RL 数据） |
| `tengu_bash_tool_used` | Bash 工具被调用 |
| `tengu_tool_use_success` | 工具调用成功 |
| `tengu_tool_use_error` | 工具调用错误 |
| `tengu_tool_use_granted_in_prompt_permanent` | 工具权限永久授予 |
| `tengu_tool_use_granted_in_prompt_temporary` | 工具权限临时授予 |
| `tengu_tool_use_rejected_in_prompt` | 工具权限拒绝 |

### 会话生命周期

| 事件名 | 描述 |
|--------|------|
| `tengu_started` | 启动 |
| `tengu_init` | 初始化完成 |
| `tengu_exit` | 退出 |
| `tengu_cancel` | 用户取消 |
| `tengu_auto_compact_succeeded` | 自动压缩成功 |
| `tengu_orphaned_messages_tombstoned` | 孤儿消息清理 |

### OAuth & 认证

| 事件名 | 描述 |
|--------|------|
| `tengu_oauth_success` | OAuth 登录成功 |
| `tengu_oauth_error` | OAuth 错误 |
| `tengu_oauth_token_refresh_failure` | Token 刷新失败 |
| `tengu_oauth_token_refresh_success` | Token 刷新成功 |
| `tengu_oauth_flow_start` | OAuth 流程启动 |

### 遥测自监控

| 事件名 | 描述 |
|--------|------|
| `analytics_sink_attached` | 遥测 sink 已连接 |
| `tengu_bridge_message_received` | Bridge 消息接收 |
| `tengu_ws_transport_reconnected` | WebSocket 重连 |

---

> **最后的话：** 这套遥测系统的存在本身不是问题——问题在于数据的主权归属。我们的改造方案证明：**你可以在不破坏基础设施的前提下，将数据的所有权从云端拉回本地**。这套代码本身就是最好的教学材料：学习 Anthropic 的工程实践，掌控自己的数据，然后用这些数据来优化自己的工作流。
> 
> 光明在于工程的精湛，阴影在于主权的缺失。我们选择照亮阴影，而不是关掉灯光。

---

*文档版本：v1.0 | 最后更新：2026-06-03*
