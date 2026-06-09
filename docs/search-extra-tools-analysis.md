# CC_Pure SearchExtraTools 机制分析

> 供 Claude 网页版审阅。本文描述 CC_Pure 当前的工具延迟加载系统，分析其对模型工具调用行为的影响，并提出简化方向。

---

## 1. 背景：为什么需要延迟加载

Claude Code 有 60+ 个内置工具 + MCP 动态工具。每次 API 调用，system prompt 中需包含全部工具的 JSON schema——这是固定的 token 开销。当 MCP 工具增多或 context window 较小时，工具定义可能占满窗口。

CC_Pure 的 SearchExtraTools 机制将工具分为两档，省 token：

| 分档 | 加载方式 | Token 开销 |
|------|---------|-----------|
| **Core**（~26 个） | 始终在 tools 数组中，模型可直接调用 | 全量 |
| **Deferred**（其余全部） | 不在 tools 数组中。模型需通过 `SearchExtraTools` 发现，再通过 `ExecuteExtraTool` 调用 | 仅工具名（一行一个） |

---

## 2. Core 工具列表

这些工具始终在模型可见的 tools 数组中，**名称和 schema 与 Anthropic 原版完全一致**：

```
Bash, Shell, Read, Edit, Write, Glob, Grep, NotebookEdit,
Agent, AskUserQuestion,
TaskCreate, TaskGet, TaskList, TaskUpdate, TaskOutput, TaskStop, TodoWrite,
EnterPlanMode, ExitPlanMode, VerifyPlanExecution,
WebFetch, WebSearch,
LSP, Skill, Sleep,
SearchExtraTools, ExecuteExtraTool
```

---

## 3. Deferred 工具列表

这些工具**不在** tools 数组中，模型看到的只是一个纯名称列表，注入在 `<system-reminder>` 消息块中：

```
CronCreate, CronDelete, CronList,
TeamCreate, TeamDelete,
SendMessage,
Config,
Think, EnterWorktree, ExitWorktree,
MCP 工具（动态）, Skill 工具（动态）
```

---

## 4. 模型实际看到的内容

### 4.1 System Prompt 中的说明（位置：`src/constants/prompts.ts:192-193`）

```
Your tool list has two categories: core tools (Read, Edit, Write, Bash, Glob,
Grep, Agent, WebFetch, WebSearch, Skill, SearchExtraTools, ExecuteExtraTool)
which are always loaded — call them directly. Additional tools (deferred tools,
MCP tools, skills) are NOT in your tool list and must be discovered via
SearchExtraTools first, then invoked via ExecuteExtraTool. SearchExtraTools and
ExecuteExtraTool are core tools in your tool list right now — do NOT use Bash,
Glob, or any other tool to find them. Call SearchExtraTools or ExecuteExtraTool
directly like you would call Read or Bash. Before telling the user a capability
is unavailable, search for it. Only state something is unavailable after
SearchExtraTools returns no match.
```

### 4.2 每轮追加的 system-reminder（位置：`src/services/api/claude.ts:1401`）

Deferred 工具名列表作为 system-reminder **追加到消息数组末尾**：

```
<system-reminder>
<available-deferred-tools>
CronCreate
CronDelete
CronList
SendMessage
TeamCreate
...
</available-deferred-tools>
IMPORTANT: The tools listed above are deferred-loading — they are NOT in your
tool list. To use them, you MUST first discover a tool via SearchExtraTools,
then invoke it with ExecuteExtraTool.

SearchExtraTools and ExecuteExtraTool are core tools already in your tool list
right now — call them directly, do NOT use Bash/Glob to find them.

Steps:
1. SearchExtraTools({"query": "select:<tool_name>"}) — discover the tool and its schema
2. ExecuteExtraTool({"tool_name": "<name>", "params": {...}}) — invoke it with correct parameters
</system-reminder>
```

---

## 5. 当前机制的问题

### 5.1 Prompt Cache 被 bust

`<system-reminder>` 作为 user message 追加到消息末尾。当 deferred tools 列表变化时（如 MCP 工具增减），这个消息的 content 变了 → prompt cache 失效。虽然 `isMeta: true` 标注减轻了部分影响，但这仍然是每轮额外的 token 开销。

### 5.2 过度防御的措辞

"You MUST"、"Steps: 1. 2."、"do NOT use Bash/Glob to find them"——这种指令式措辞假设模型不理解工具发现机制。实际上 Claude 的训练数据中已有工具发现的模式，`SearchExtraTools` 就在 Core 工具列表里，模型知道怎么用它。多余的防御性指令吃 token 且可能干扰模型自身的判断。

### 5.3 信息冗余

同样的信息出现了两处：
1. System prompt 讲了一遍 Core vs Deferred 的规则
2. 每轮 system-reminder 又重复了一遍完整的操作步骤

两者可以合并。模型不需要每轮都被提醒"Steps: 1. 2."。

---

## 6. 对模型工具调用「肌肉记忆」的影响

### 6.1 不受影响的部分

- Core 工具（Bash、Read、Edit、Write、Glob、Grep、Agent、WebFetch、WebSearch 等）名称和 schema **完全未改**。模型训练时最常调用的工具就是这几个，它们始终在 tools 数组中，模型可以零摩擦调用。
- `SearchExtraTools` 和 `ExecuteExtraTool` 的名字和功能与 Anthropic 训练数据中的工具发现模式一致。

### 6.2 可能有轻微摩擦的部分

- Deferred 工具（如 CronCreate、TeamCreate）模型不能直接调，需先 `SearchExtraTools` 发现再 `ExecuteExtraTool` 调用。多一两个 turn，但这些都是低频工具。
- 如果训练数据中模型曾被训练为「直接调用 CronCreate」，那它第一次可能会尝试直接调 → 工具不在列表中 → 模型会自然 fallback 到 SearchExtraTools 搜索。这是训练好的行为。

---

## 7. 简化方向

将 system-reminder 合并到 system prompt 中，用一句自然的描述替代指令式措辞。效果：

### 7.1 删除：每轮的 `<system-reminder>` 追加

不再每轮向消息末尾追加 deferred tools 列表和操作步骤。消除 prompt cache bust 的隐患。

### 7.2 简化：System Prompt 中的说明

从当前 8 行指令式措辞 → 1-2 句自然描述：

**当前**：
```
Your tool list has two categories: core tools (...) which are always loaded
— call them directly. Additional tools (deferred tools, MCP tools, skills)
are NOT in your tool list and must be discovered via SearchExtraTools first,
then invoked via ExecuteExtraTool. SearchExtraTools and ExecuteExtraTool are
core tools in your tool list right now — do NOT use Bash, Glob, or any other
tool to find them. Call SearchExtraTools or ExecuteExtraTool directly like
you would call Read or Bash. Before telling the user a capability is
unavailable, search for it. Only state something is unavailable after
SearchExtraTools returns no match.
```

**建议**：
```
Some less-frequently-used tools are not in your immediate tool list — their
names are listed in <available-deferred-tools> below. If you need one, use
SearchExtraTools to discover its full schema, then ExecuteExtraTool to call
it. Both are in your tool list now — call them directly like any other tool.
```

### 7.3 保留：Deferred 工具名列表

工具名列表仍然需要出现——模型需要知道有哪些 deferred 工具存在，才能决定是否搜索。可以放在 system prompt 末尾而非每轮追加。

---

## 8. 已踩过的坑（历史记录）

| Commit | 问题 | 说明 |
|--------|------|------|
| `2c501012` | MCP 工具失败后死循环 | SearchExtraTools → 调用失败 → 再搜 → 死循环 |
| `8f01d5cc` | 模型不认 SearchExtraTools | 提示词不够明确，模型试图用 Bash/Grep 找工具 |
| `1201d88c` | Turn-zero 推荐弹窗 | 首次对话弹出工具推荐干扰 |
| `eaa6199f` | 缓存失效 | Deferred 工具列表变化时动态注入逻辑错误 |
| `70d6b288` | OpenAI 兼容层 | OpenAI endpoint 的 deferred tools 处理独立于 Anthropic |

这些修复已经使系统稳定运行。当前版本在 DeepSeek V4 Pro + CCP 上跑 SWE-bench Lite 90 实例无工具调用异常。

---

## 9. 总结

| 维度 | 当前状态 | 改进空间 |
|------|---------|---------|
| 工具名 | **未改**，与 Anthropic 原版一致 | — |
| 高频工具可用性 | Core 工具始终在列表，模型肌肉记忆完整 | — |
| 低频工具发现 | 需 SearchExtraTools → ExecuteExtraTool，多 1-2 turn | 可接受，低频工具省下的 token 远大于多出的 turn |
| Prompt 措辞 | 过度防御，指令式，冗余 | 简化为自然描述，合并到 system prompt |
| Cache 效率 | 每轮追加 system-reminder，可能 bust cache | 移到 system prompt 一次性注入 |
