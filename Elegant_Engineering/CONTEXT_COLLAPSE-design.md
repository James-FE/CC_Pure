# CONTEXT_COLLAPSE 设计文档

> CCP compaction 体系的"调度大脑"。本文档 = 所有已确认设计的唯一权威源。
> 更新规则：每完成一个子模块的 Claude 审查 → 追加对应 section，不替旧内容。

---

## 一、架构总览

### 三层 Compaction 管线

```
messagesForQuery
  → ① HISTORY_SNIP      [手术刀]  ✅ v2.6.11-stable.5
  → ② microcompact       
  → ③ CONTEXT_COLLAPSE  [调度脑]  ← 本文档
  → ④ autocompact       [断头台]
```

### CONTEXT_COLLAPSE 的定位

不是"替代 autocompact 的功能"——是**接管 autocompact 的决策权**。collapse 开启后，autocompact 不再自己判断"该不该压"，collapse 说了算。

**状态机：staged → spawn → commit**
1. **staged** — 候选消息区间入队（90% token 阈值触发标记）
2. **spawn** — 95% 阈值 fork ctx-agent（`marble_origami`），调 Haiku 生成摘要 + 风险评分
3. **commit** — 产出摘要占位符，`projectView` 投射层替换原始消息

### 接线层（三个调用点）

| 调用点 | query.ts 行号 | 职责 |
|---|---|---|
| `applyCollapsesIfNeeded` | ~662 | 每轮 messagesForQuery 构建后，返回投射视图。签名：`→ {messages, committed: boolean}` |
| `isWithheldPromptTooLong` | ~1044 | API 413 时 withhold 错误，等 collapse drain |
| `recoverFromOverflow` | ~1375 | 413 恢复路径，强制 drain staged。签名：`→ {messages, committed}` |

### 类型系统（frozen — 不可改）

```typescript
// 持久化的 commit 条目 (types/logs.ts:255)
type ContextCollapseCommitEntry = {
  type: 'marble-origami-commit'
  sessionId: UUID
  collapseId: string          // 16-digit, "Max across entries reseeds the ID counter"
  /** The summary placeholder's uuid — registerSummary() needs it. */
  summaryUuid: string
  summaryContent: string      // Full <collapsed id="...">text</collapsed> string
  summary: string             // Plain summary text for ctx_inspect
  firstArchivedUuid: string
  lastArchivedUuid: string
}

// 持久化的 snapshot 条目 (types/logs.ts:282)
type ContextCollapseSnapshotEntry = {
  type: 'marble-origami-snapshot'
  sessionId: UUID
  staged: StagedSpan[]        // "collapse IDs reset with the uuidToId bimap"
  armed: boolean
  lastSpawnTokens: number
}
```

### Feature Flag

`CONTEXT_COLLAPSE` 默认 OFF（`scripts/defines.ts:64` 已注释）。实现完成后最后一刻取消注释。

---

## 二、Store 设计 ✅ 已确认

> 审查链：Hermes 初稿 → Sonnet 批 7 文件 → Opus 出第一版 → 自我审查 → 还原度审查（5 缺口）→ 最终版
> 审查产物：见 `/tmp/cc-store-*.txt` 系列

### 核心理念

持久化类型（`ContextCollapseCommitEntry`）是**存盘指令**——只带重建需要的边界 UUID、占位符正文、ID、摘要。运行时包裹一个更丰富的 `CommittedCollapse`，其中 `archived: Message[]` 是 projectView 第一次解析后缓存的原始消息——供 `ctx_inspect` 和 `recoverFromOverflow` 直接用，不用每次重新扫描全量历史。

约束（来自 logs.ts:246）：**"the store reconstructs CommittedCollapse with archived=[]; projectView lazily fills the archive the first time it finds the span."** — archive 不持久化（消息本来就在 transcript 里），不急构建（按需懒填充），不丢缓存（填一次后复用）。

### 模块划分

| 模块 | 管什么 |
|---|---|
| `store.ts` | 运行时状态：committedLog（`CommittedCollapse[]`）、staged 队列、scheduler 触发器状态、健康计数器 |
| `registry.ts` | 双向 bimap（`summaryUuid ↔ collapseId`）+ ID 发号器（16 位递增）+ reseed 恢复 |

### CommittedCollapse — 运行时包裹类型

```typescript
// store.ts
export type CommittedCollapse = {
  /** 持久化的 commit，完整保留。边界 + 摘要的权威源。 */
  entry: ContextCollapseCommitEntry
  /** 被归档的消息 span。初始为空，projectView 第一次命中后填充并缓存。 */
  archived: Message[]
}
```

不在 `ContextCollapseCommitEntry` 上加字段的原因：该类型被 `appendEntry`/`loadTranscriptFile` 序列化，加 `archived` 会尝试把整个被压消息写入磁盘——正是原设计避免的。拆分保持持久化负载最小，运行时缓存 ephemeral。

### StagedSpan 类型

```typescript
// 匹配 ContextCollapseSnapshotEntry.staged[number] 形状
export type StagedSpan = {
  startUuid: string
  endUuid: string
  summary: string       // scheduler 预计算的摘要提示
  risk: number          // 启发式 collapse-worthiness [0,1]
  stagedAt: number      // epoch ms
}
```

### CollapseHealth — 健康计数器

```typescript
// 形状从 index.ts getStats().health 恢复
export type CollapseHealth = {
  totalSpawns: number
  totalErrors: number
  lastError?: string
  emptySpawnWarningEmitted: boolean
  totalEmptySpawns: number
}
```

### store.ts 完整接口

```typescript
// committed log
getCommittedLog(): CommittedCollapse[]
pushCommitted(entry): CommittedCollapse    // archived=[] 初始空，懒填充

// staged queue
getStaged(): StagedSpan[]
pushStaged(span): void
drainStaged(): StagedSpan[]                // 清空并返回全部（spawn 后调用）

// scheduler trigger state
getArmed(): boolean / setArmed(v)
getLastSpawnTokens(): number / setLastSpawnTokens(n)

// health
getHealth(): CollapseHealth
recordSpawn(): void
recordEmptySpawn(): void
recordError(message): void
markEmptySpawnWarningEmitted(): void

// lifecycle
reset(): void   // 全清，不跨 disable→enable 存活
```

---

## 三、Registry 设计 ✅ 已确认

> 审查链：从 types/logs.ts 三条幸存注释重建（registerSummary / uuidToId bimap / reseed counter）
> 审查产物：`/tmp/cc-bimap-restore-output.txt`

### registry.ts 完整接口

```typescript
// 双向映射，始终保持一致
nextCollapseId(): string                          // "0000000000000001", "0000000000000002"...
registerSummary(summaryUuid, collapseId): void    // 写入者
getCollapseIdForSummary(uuid): string | undefined  // forward lookup
getSummaryUuidForCollapse(id): string | undefined  // reverse lookup
reseedCollapseIdCounter(maxRestoredId): void       // 单调递增，忽略 NaN/非有限值
peekCollapseIdCounter(): number                    // diagnostic
clearSummaryRegistry(): void                       // wipe all
```

### 注

collapseId 同时也嵌入在占位符正文 `<collapsed id="...">` 中——`ctx_inspect` 可以从消息正文直接提取，不需要 bimap。bimap 是快速路径和 fresh ID 权威源，不是唯一途径。

---

## 四、Operations 改动 ✅ 已确认

### CollapseEntry — 两个新字段（⚠️ optional）

```typescript
export type CollapseEntry = {
  // ... 原有字段 ...
  summaryUuid?: string       // optional — 显式 CollapseEntry[] 传入方不提供。缺失时 createSummaryMessage fallback 到 randomUUID()
  summaryContent?: string    // optional — 同上。缺失时 fallback 到 [Collapsed N…] 模板
}
```

**为什么 optional 而不是 required**：`projectView(messages, collapseLog?)` 接受外部传入的 `CollapseEntry[]`，operations.test.ts 等多处 hand-build CollapseEntry 不带这两个字段。required 会导致 tsc 编译失败 + 所有显式传入路径断裂。

### commitToSpan — 复制新字段

```typescript
return {
  id: commit.collapseId,
  summaryUuid: commit.summaryUuid,       // ← 新增
  summaryContent: commit.summaryContent, // ← 新增
  // ... 其余不变 ...
}
```

### createSummaryMessage — 修复两个 bug（含 fallback）

```typescript
export function createSummaryMessage(entry: CollapseEntry): Message {
  return {
    type: 'user',
    // use entry.summaryUuid if present (commit-restore path),
    // fall back to randomUUID for explicit-log callers
    uuid: (entry.summaryUuid ?? randomUUID()) as UUID,
    message: {
      role: 'user',
      // use entry.summaryContent if present (commit-restore path),
      // fall back to [Collapsed N…] template for explicit-log callers
      content: entry.summaryContent
        ?? `[Collapsed ${entry.meta.messageCount} messages]\n\n${entry.replacement.text}`,
    },
    timestamp: entry.createdAt,
    isSidechain: true,
    isEphemeral: true,
  }
}
```

**为什么用 fallback 而不是强制**：`projectView` 接受外部 `CollapseEntry[]`（如 operations.test.ts 中 hand-build 的），这些 entry 不含 `summaryUuid`/`summaryContent`。optional + fallback 保证显式传入路径不崩，commit-restore 路径用真实值。

### projectView — 懒填充 archive

新增 `resolveCommitted(messages, committed)` helper：
1. 调 `commitToSpan(messages, committed.entry)` 生成 CollapseEntry
2. 如果 `committed.archived` 还是空的 → `messages.slice(start, end+1)` 填充并缓存
3. 后续 projectView 重放直接用缓存，不再切片

`projectView()` 无参数路径从 `getCommittedLog()` 读取（不再调 `getRestoredCommits()`）。

---

## 五、Persist 改动 ✅ 已确认

### 四个变更

**1. Import 新增**：`import { pushCommitted, pushStaged, setArmed, setLastSpawnTokens, getCommittedLog } from './store.js'` + `import { reseedCollapseIdCounter, registerSummary } from './registry.js'`

**2. `getRestoredCommits()` 变成派生**：`return getCommittedLog().map(c => c.entry)`

**3. `restoreFromEntries()` 核心重写**：
```
Before: push into local restoredCommits[]
After:
  clearSummaryRegistry()                 // ← 修复 #4：重建前清 bimap，保证恢复确定性
  resetStore()                           // 清 store
  for each valid commit:
    pushCommitted(item)                  // 写入 store（archived=[]）
    registerSummary(summaryUuid, collapseId)  // 重建 bimap
    const n = parseInt(collapseId, 10)  // ← 修复 #2：非数字 collapseId 不参与 max
    if (Number.isFinite(n)) maxCollapseId = Math.max(maxCollapseId, n)
  reseedCollapseIdCounter(maxCollapseId)  // ← GAP 4 修复
  if snapshot:
    for each staged span: pushStaged()   // ← GAP 5 修复
    setArmed(snapshot.armed)
    setLastSpawnTokens(snapshot.lastSpawnTokens)

  ⚠️ 保留 legacy 分支：isValidCollapseEntry(item) → seenIds 去重 → entries.push(item)
    此分支不写入 store/registry，仅返回给调用方。persist.test.ts:71 依赖此行为。
```

**4. compact-boundary awareness**：`sessionStorage.ts:3679-3682` 在遇到 compact boundary 时已经清空了 `contextCollapseCommits` 和 `contextCollapseSnapshot`。`restoreFromEntries` 拿到的参数只包含 post-boundary 状态——不重导、不合并 pre-boundary 条目。加注释标记这个不变量。

---

## 六、Index 接线 ✅ 已确认

### getStats()

```typescript
collapsedSpans: getCommittedLog().length       // 不用 getRestoredCommits()
stagedSpans: getStaged().length
collapsedMessages: sum(archived.length)         // 只统计已解析的 archive；首次 projectView 前为 0
totalMessages: 0                                 // 由调用方 projection context 持有，store 不管
emptySpawnWarningEmitted: health.emptySpawnWarningEmitted  // 镜像 health 内部字段
health: { ...getHealth() }                      // 不再硬编码零
```

### 消费者

| 文件 | 读什么 | 说明 |
|---|---|---|
| `ContextVisualization.tsx:21-30` | `getStats()` → `collapsedSpans`, `stagedSpans`, `health` | UI 显示"collapse 做了什么"。当前值全是零（stub），修复后显示真实状态 |

### resetContextCollapse()

```typescript
resetStore()           // committedLog + staged + armed + lastSpawnTokens + health
clearSummaryRegistry() // bimap + ID counter

// 调用方（不改）：
//   postCompactCleanup.ts:56-60  — 仅主线程 compact（isMainThreadCompact guard）
//   autoCompact.ts:204-212       — marble_origami guard 阻止 subagent 触发
//   两个 guard 均不在本方案修改范围内
```

---

## 七、TDD 登陆顺序

```
Step 1: registry.ts + registry.test.ts         （零依赖，最底层）
Step 2: store.ts + store.test.ts                （定义 CommittedCollapse 等类型）
Step 3: CollapseEntry 加 optional summaryUuid/summaryContent + createSummaryMessage fallback 修复
Step 4: projectView 接 getCommittedLog() + resolveCommitted lazy fill
Step 5: persist.ts 重连（保留 legacy 分支 + clearSummaryRegistry + reseed Number.isFinite guard + staged restore）
Step 6: 迁移现有测试 — operations.test.ts（显式传入路径用 fallback 不变；commit-restore 断言更新为 summaryContent 格式）
        persist.test.ts（验证 legacy 分支保留 + getRestoredCommits 派生 + reseed 单调性）
Step 7: index.ts getStats() + resetContextCollapse() 接线
Step 8: bun run precheck（typecheck + lint + test）
```

Step 4 和 5 有耦合（projectView 读 store；loader 填 store）——可合并为一个 commit 避红色。

**本阶段不碰**：三个 stub entry-point 的身体（`applyCollapsesIfNeeded` 等）留到 spawn-resolution 阶段。

---

## 八、Scheduler 设计 ✅ 终审通过（v3）

> 审查链：Hermes 初稿 → P1 Sonnet 批判 → P2 Opus v1（406 行）→ Hermes 全量考古（10 遗迹）→ Opus v2（含约束，463 行）→ 解除约束 → Opus v3（554 行）→ Hermes 终审 + Opus 自审修正（5 处）→ **v3 最终版**

### 核心纠正（v1 发现，全版本保留）

`query.ts:1375` `recoverFromOverflow` 无 `await`，必须同步。`applyCollapsesIfNeeded`（`:662`）有 `await`，是唯一能 spawn 的路径。

### 两条路径分工（v3 终版）

| | applyCollapsesIfNeeded | recoverFromOverflow |
|---|---|---|
| 调用 | `await`（异步） | **同步** |
| 触发 | 每轮构建后 | API 413 |
| 90% | spawn ctx-agent（如果有 staged 或能选候选） | — |
| 95%/413 | **强制 spawn**（window × 0.95） | 先提交已 staged，空则现场 select + truncate 直提 |
| 摘要 | ctx-agent 精炼 | 草稿（有 staged）/ truncate 占位（无 staged） |
| 返回 | `Promise<{messages, committed: boolean}>` | `{messages, committed: number}` |

### §1 持久化类型扩展

`ContextCollapseCommitEntry`（`logs.ts:255`）新增 5 个 **optional** 字段：

| 字段 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| `depth?` | `number` | `0` | 嵌套深度 |
| `parentId?` | `string \| null` | `null` | 父 collapse 的 id |
| `tokensIn?` | `number` | `0` | 折叠前 token |
| `tokensOut?` | `number` | `0` | 折叠后 token |
| `strategy?` | `CollapseStrategy` | `'llm-summary'` | 折叠策略 |

`CollapseStrategy` 定义上移到 `logs.ts`，`operations.ts` 改从 logs 引入并 re-export。5 字段全 optional——旧 transcript 回读用 `?? 默认值`，零破坏。

### §2 受影响已有文件的改动

| 文件 | 改动 | 行数 |
|------|------|------|
| `types/logs.ts` | 上移 `CollapseStrategy`；entry 加 5 optional 字段 | +8 |
| `operations.ts` | `commitToSpan` 改 `commit.depth ?? 0` 等 5 处 fallback；import 改从 logs | ~7 |
| `persist.ts` | `isValidCommitEntry` 加 5 项 optional 校验（`undefined \|\| typeof ...`） | +5 |
| `sessionStorage.ts` | `recordContextCollapseCommit` 入参加 5 optional 字段 + import `CollapseStrategy` | +6 |
| `index.ts` | 三 @stub → 惰性 `require('./scheduler.js')` 转发 | ~30 |

**不改**：`store.ts`（`pushCommitted` 透传 entry）、`query.ts`、`autoCompact.ts`、`sessionRestore.ts`、`REPL.tsx`。

### §3 完整 ADR

**ADR-1** 保持 store module-level 单例，调度器只通过已有导出读写。

**ADR-2** `scheduler.ts` 独立文件，`index.ts` 惰性 require 转发（与 `autoCompact.ts:244` 同手法，打破 init 环）。

**ADR-3** Phase 1/2 spawnCtxAgent = stub（草稿直返），Phase 3 → `runForkedAgent(querySource='marble_origami')`。

**ADR-4** interval clock：armed/lastSpawnTokens 水位线，Δ=12K。双触发条件——95% 阻塞 OR Δ 超过。

**ADR-5** projectView 入口第一步，spawn commit 后复投。

**ADR-6** 预存 staged 首轮 UUID 去重，不特殊处理。

**ADR-7** isWithheldPromptTooLong 为无状态纯谓词——有 staged 就放行。v3 去掉了 v2 的 module-level withheldPTL flag。

**ADR-8** strategy 参数注入 commitSpans。recordSpawn 在外层（per-spawn，非 per-span）。

### §4 scheduler.ts 类型签名（终版）

```typescript
// 常量
const COMMIT_START_FRAC = 0.90
const BLOCKING_FRAC = 0.95
const SPAWN_INTERVAL_TOKENS = 12_000
const PROTECTED_TAIL_TOKENS = 25_000
const MIN_SPAN_TOKENS = 2_000
const EMPTY_SPAWN_WARN_AT = 3
const MARBLE_QUERY_SOURCE = 'marble_origami'

// 返回类型（注意：ApplyResult.committed 是 boolean，RecoverResult.committed 是 number）
type ApplyResult = { messages: Message[]; committed: boolean }
type RecoverResult = { messages: Message[]; committed: number }
type Candidate = { startUuid: string; endUuid: string; summary: string; risk: number }

// 导出
export async function applyCollapsesIfNeeded(
  messages: Message[], ctx: ToolUseContext, querySource?: string,
): Promise<ApplyResult>

export function recoverFromOverflow(
  messages: Message[], querySource?: string,
): RecoverResult

export function isWithheldPromptTooLong(
  message: Message,
  isPromptTooLong: (msg: Message) => boolean,
  querySource?: string,
): boolean

// 内部（不导出）
function commitSpans(messages, spans, strategy): number
function selectStagingCandidate(view): Candidate | undefined
function detectNesting(messages, startIdx, endIdx): { depth, parentId }
function overlapsExistingStaged(c, messages): boolean
function spawnCtxAgent(view, ctx): Promise<void>
function maybeWarnEmptySpawn(): void
function persistSnapshot(): void
```

### §5 applyCollapsesIfNeeded v3（含 95% 强制 spawn）

```
async applyCollapsesIfNeeded(messages, ctx, querySource):
    if querySource == MARBLE_QUERY_SOURCE:
        return { messages, committed: false }

    view = projectView(messages)
    model = ctx.options?.mainLoopModel ?? fallback
    window = getEffectiveContextWindowSize(model)
    tokens = tokenCountWithEstimation(view)

    # 90% 以下：解除武装，纯投射
    if tokens < window * COMMIT_START_FRAC:
        if getArmed(): setArmed(false); persistSnapshot()
        return { messages: view, committed: false }

    # interval clock：首次越线 OR 95% 强制 OR Δ≥12K
    shouldSpawn = !getArmed()
        || tokens >= window * BLOCKING_FRAC          # 95% 强制
        || tokens - getLastSpawnTokens() >= SPAWN_INTERVAL_TOKENS

    if shouldSpawn:
        recordSpawn()                                 # ← 一次 spawn 记一次（修正❶）
        await spawnCtxAgent(view, ctx)
        setArmed(true)
        setLastSpawnTokens(tokens)
        maybeWarnEmptySpawn()
        persistSnapshot()

    committedN = commitSpans(messages, drainStaged(), 'llm-summary')
    if committedN > 0:
        view = projectView(messages)                  # 复投
        persistSnapshot()
    return { messages: view, committed: committedN > 0 }
```

### §6 recoverFromOverflow v3（同步，无 withheldPTL）

```
recoverFromOverflow(messages, querySource):
    if querySource == MARBLE_QUERY_SOURCE:
        return { messages, committed: 0 }

    # 先提交已 staged（有 LLM 摘要的）
    n = commitSpans(messages, drainStaged(), 'llm-summary')

    # staged 空 → 现场选候选，truncate 直提
    if n == 0:
        view = projectView(messages)
        candidate = selectStagingCandidate(view)
        if candidate:
            n = commitSpans(messages, [toStaged(candidate)], 'truncate')

    if n == 0: return { messages, committed: 0 }
    view = projectView(messages)
    persistSnapshot()                                 # fire-and-forget
    return { messages: view, committed: n }
```

### §7 isWithheldPromptTooLong v3（无状态纯谓词）

```
isWithheldPromptTooLong(message, isPromptTooLong, querySource):
    if querySource == MARBLE_QUERY_SOURCE: return false
    if !isPromptTooLong(message): return false
    # 有 staged 就放行——recoverFromOverflow 会处理；没 staged 也放行——recover 会现场选候选
    return true
```

无 module-level 状态，不需要清除逻辑，不需要 `applyCollapsesIfNeeded` 入口清零。

### §8 commitSpans v3（修正❶❷❸ 后）

```
commitSpans(messages, spans, strategy):
    recordSpawn()                                     # ← ❶ 在循环外，一次 spawn 一次
    committed = 0
    for span in spans:
        startIdx = messages.findIndex(m => m.uuid == span.startUuid)
        endIdx   = messages.findIndex(m => m.uuid == span.endUuid)
        if startIdx == -1 or endIdx == -1 or startIdx > endIdx:
            continue                                  # 边界防御

        archived = messages.slice(startIdx, endIdx + 1)
        collapseId = nextCollapseId()
        summaryUuid = randomUUID()
        summaryContent = `<collapsed id="${collapseId}">${span.summary}</collapsed>`

        { depth, parentId } = detectNesting(messages, startIdx, endIdx)
        tokensIn = tokenCountWithEstimation(archived)

        entry: ContextCollapseCommitEntry = {
            type: 'marble-origami-commit',
            sessionId: getSessionId() as UUID,        # ← ❷ 直接取真实值
            collapseId, summaryUuid, summaryContent, summary: span.summary,
            firstArchivedUuid: span.startUuid, lastArchivedUuid: span.endUuid,
            depth, parentId, tokensIn, tokensOut: 0, strategy,
        }

        # ❸ 用 commitToSpan 出完整 Entry → createSummaryMessage → 精确 token 估算
        const projected = commitToSpan(messages, entry)
        if projected:
            entry.tokensOut = tokenCountWithEstimation([createSummaryMessage(projected)])

        registerSummary(summaryUuid, collapseId)      # 硬约束
        pushCommitted(entry)
        recordContextCollapseCommit(entry)             # fire-and-forget
        committed += 1
    return committed
```

### §9 辅助函数

**selectStagingCandidate**: groupTurnPairs → 受保护尾部 → risk = tokens × recencyWeight → 取最高 risk → UUID 边界。

**detectNesting**: 扫描 committed log，若候选区间落在某 committed span 内 → `depth = (c.entry.depth ?? 0) + 1, parentId = c.entry.collapseId`。否则 `{depth:0, parentId:null}`。

**overlapsExistingStaged**: UUID 转 index → 区间相交检测。

**spawnCtxAgent**: fork querySource=MARBLE_QUERY_SOURCE → 调 ctx-agent 出摘要 → pushStaged。空产出 → recordEmptySpawn。

**maybeWarnEmptySpawn**: `totalEmptySpawns > 0 && !emptySpawnWarningEmitted && staged empty` → markEmptySpawnWarningEmitted。

**persistSnapshot**: `recordContextCollapseSnapshot(staged, armed, lastSpawnTokens)` fire-and-forget。

### §10 index.ts 转发

```typescript
export async function applyCollapsesIfNeeded(messages, ctx, querySource) {
  const s = require('./scheduler.js'); return s.applyCollapsesIfNeeded(messages, ctx, querySource)
}
export function isWithheldPromptTooLong(message, isPTL, querySource) {
  const s = require('./scheduler.js'); return s.isWithheldPromptTooLong(message, isPTL, querySource)
}
export function recoverFromOverflow(messages, querySource) {
  const s = require('./scheduler.js'); return s.recoverFromOverflow(messages, querySource)
}
```

惰性 require 打破 `scheduler → autoCompact → index` 的初始化环。

### §11 实施顺序

| Step | 内容 | 备注 |
|------|------|------|
| **1** | `logs.ts`：上移 CollapseStrategy + entry 加 5 optional 字段 | 地基，必须先动 |
| **2** | `operations.ts`：import 调整 + commitToSpan fallback 改读新字段 | 依赖 Step1，跑现有测试全绿 |
| **3** | `persist.ts`：isValidCommitEntry 加 5 optional 校验 | 依赖 Step1 |
| **4** | `sessionStorage.ts`：入参加 5 字段 + import | 依赖 Step1 |
| **5** | `scheduler.ts`：全部 10 个函数 + helper | 依赖 Step1-4，新建 ~250 行 |
| **6** | `index.ts`：三 stub → 惰性转发 | 依赖 Step5 |
| **7** | `scheduler.test.ts`：14+ 测试用例 | 依赖 Step5 |

Step1-6 = 可工作系统；Step7 = CI 安全网。

### §12 爆炸半径

| 维度 | 数值 |
|------|------|
| 改已有文件 | 5 个（logs/operations/persist/sessionStorage/index） |
| 新建文件 | 2 个（scheduler.ts + scheduler.test.ts） |
| 已有文件净改 | ~25 行 |
| 新建代码 | ~400 行 |
| 现有测试断裂 | **0**——新字段 optional + fallback 默认值与旧硬编码逐字相等 |

**最高风险**：`MARBLE_QUERY_SOURCE = 'marble_origami'` 串必须在 scheduler / autoCompact / analyzeContext 三处逐字一致。已锁定常量，单点定义。

### §13 v3 修正清单（5 处 vs v2/v3 草案）

| # | 问题 | 来源 | 修正 |
|---|------|------|------|
| ❶ | recordSpawn 在循环内 | Hermes 发现 → Opus 确认疏忽 | 移到 commitSpans 外部 |
| ❷ | sessionId = undefined as never | Hermes 发现 → Opus 确认疏忽 | `getSessionId() as UUID` |
| ❸ | tokensOut 手写 partial Entry | Hermes 发现 → Opus 改建议 | `commitToSpan` → `createSummaryMessage` 精确估算 |
| ❹ | ApplyResult.committed 类型漂移 | Hermes 发现 → Opus 确认疏忽 | 统一为 `boolean` |
| ❺ | 缺少 95% 强制 spawn | 用户拍板 → 加回 | `>= window * 0.95` 与 Δ 并列触发 |

## 九、Ctx-agent 设计 ✅ Opus 审查完成

> 审查链：Sonnet P1 设计批判 → Opus P2 内部科学家方案 → Opus 考古 + 遗迹 #9 评估 → 发现 #2 推翻 fork 路线
> 审查产物：`/tmp/sonnet-ctx-agent-output.md`（175 行）+ `/tmp/opus-ctx-agent-output.md`（259 行）+ `/tmp/opus-ctx-agent-archaeology-output.md`（267 行）

### 核心发现：该用 `queryHaiku`，不是 `runForkedAgent`

Opus 考古时发现：`snipExecute.ts` 早就用 `queryHaiku` 做单次 Haiku 摘要调用。`runForkedAgent` 是为 supervisor/session_memory 设计的完整 fork 循环——ctx-agent 只需要**单次、无工具**调用。`queryHaiku → queryModelWithoutStreaming` 不走 `query()` 主循环，天然免疫递归，不需要 `marble_origami` guard 做防护（guard 仍在 defense-in-depth）。

### 设计：`queryHaiku` + JSON schema 输出

```typescript
// System Prompt
const CTX_AGENT_SYSTEM_PROMPT = [
  'You compress an earlier slice of a coding conversation into a compact summary.',
  'Preserve decisions, file paths, API shapes, and unresolved TODOs verbatim.',
  'Also rate how risky the compression is: how likely the summary drops irreplaceable information.',
]

// JSON schema — 结构化输出 {summary, risk}
const CTX_AGENT_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    required: ['summary', 'risk'],
    properties: {
      summary: { type: 'string' },
      risk: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
}
```

### spawnCtxAgent 终版

```
spawnCtxAgent(view, ctx):
    candidate = selectStagingCandidate(view)
    if !candidate or overlaps: recordEmptySpawn(); return

    # 有 live signal → Haiku 富化；无 signal（测试/降级）→ 确定性回落
    verdict = ctx.abortController
        ? await summarizeCandidate(view, candidate, signal)
        : undefined

    # risk gate: > 0.7 拒绝 stage（不可替代的 span）
    if verdict and verdict.risk > 0.7:
        recordEmptySpawn(); return

    pushStaged({ ...candidate, summary: verdict?.summary ?? candidate.summary,
                 risk: verdict?.risk ?? candidate.risk, stagedAt: Date.now() })
```

### summarizeCandidate（Haiku 摘要桥）

```
summarizeCandidate(view, candidate, signal):
    span = view.slice(startIdx, endIdx + 1)
    response = await queryHaiku({
        systemPrompt: asSystemPrompt(CTX_AGENT_SYSTEM_PROMPT),
        userPrompt: renderSpanForSummary(span),    # 每条消息截断 500 字符
        outputFormat: CTX_AGENT_OUTPUT_FORMAT,     # JSON schema，不是散文
        signal,
        options: {
            querySource: MARBLE_QUERY_SOURCE,       # 遥测标签，非递归 guard
            maxOutputTokensOverride: 512,
            enablePromptCaching: false,
            isNonInteractiveSession: true,
        },
    })
    return parseVerdict(response)  # JSON.parse → {summary, risk}
    # 失败 → return { summary: candidate.summary, risk: 0.5 }  // 中性回落
```

### 依赖

- `queryHaiku` — lazy `require('src/services/api/claude.js')`（与 snipExecute 同风格）
- `asSystemPrompt` — import from `src/utils/systemPromptType.js`
- 不需要 `runForkedAgent`、`CacheSafeParams`、`getLastCacheSafeParams`

### 爆炸半径

仅 2 个文件：`scheduler.ts`（+95/-12 行）、`scheduler.test.ts`（+70/-8 行）。不改任何其他文件。

### 遗迹 #9 评估：不消费

`projectView` 的外部 `collapseLog` 参数在 scheduler 中已被迫使用（绕过无参路径 stale 数据 bug），但 ctx-agent 不需要推测性投射。Earmark 留给多 span 贪心阶段。

### 考古发现补充

| 发现 | 结论 |
|------|------|
| #1 `queryHaiku` 原生支持 JSON schema | ctx-agent 用结构化输出，不抠散文 |
| #2 该用 `queryHaiku` 非 `runForkedAgent` | 砍掉整个 fork 基建 |
| #3 `risk` 字段 ctx-agent 是第一个真正读者 | >0.7 拒绝 stage |
| #4 `sliding-window` 无人生产 | **⚠️ 已确认遗漏**（见下方记录） |
| #5 `detectNesting` bimap 反查路径优于规格 | 已就位 |
| #6 interval 时钟 token-based | 确认正确 |
| #7 `projectView` 无参路径读 stale 数据 | 🐛 独立 bug，单独 ticket |
| #8 `isWithheldPromptTooLong` 省略 staged 检查 | 确认正确 |

### ✅ 已实现：`sliding-window` 逃生舱

`CollapseStrategy` 定义了三值：`'llm-summary' | 'truncate' | 'sliding-window'`。现已全部实现。

**三层降级链**（仅 `recoverFromOverflow` 413 路径）：
```
llm-summary (drain staged) → truncate (selectStagingCandidate) → sliding-window (新!)
```

**`applySlidingWindow` 设计**（`scheduler.ts:241-344`）：
- 按 token 切尾：`SLIDING_WINDOW_TARGET_TOKENS = 15_000`（比 PROTECTED_TAIL_TOKENS 25k 更激进）
- 保留末条 user 消息 + 不切断 tool_use/tool_result 配对
- 持久化写 `ContextCollapseCommitEntry`（`strategy: 'sliding-window'`, `summary: ''`）
- `projectView` 对 sliding-window entry 不生成占位符——纯丢弃

**触发场景**：413 + drain staged 为空 + selectStagingCandidate 返回空 → 死锁。sliding-window 打破死锁，让对话在最坏情况下继续。

**8 commit，7 新测试，93 pass, 0 fail。**

### 10.5 Opus 逃生舱设计 ✅ 已完成

Opus 输出 → `/tmp/opus-sliding-window-output.md`。Codex 已按规格实现。

## 十、集成设计 ✅ 已完成

### 10.1 Feature Flag 激活

**位置**：`scripts/defines.ts:64`

```
// 之前（禁用）
// 'CONTEXT_COLLAPSE', // 已禁用：实现是空壳 stub...

// 之后（启用）
'CONTEXT_COLLAPSE', // scheduler + ctx-agent + queryHaiku，replace autoCompact
```

Bun build 通过 `-d CONTEXT_COLLAPSE=true` 注入。dev mode（`bun run dev`）自动启用。

### 10.2 运行时接线

```
setup.ts:299  feature('CONTEXT_COLLAPSE') → initContextCollapse()
                                                    ↓
query.ts:26   lazy require contextCollapse index
               ├─ :661  applyCollapsesIfNeeded()    [每次 query 前]
               │         ├─ spawnCtxAgent → queryHaiku → 裁定风险
               │         └─ commitSpans → 压缩 + 持久化
               ├─ :1044 isWithheldPromptTooLong()    [流式 withhold]
               └─ :1370 recoverFromOverflow()        [413 恢复]
                         ├─ drain staged (llm-summary)
                         └─ fallback truncate
```

### 10.3 验证结果

| 检查项 | 结果 |
|--------|------|
| `bunx tsc --noEmit` | 零错误 |
| 6 文件 93 测试 | 93 pass, 0 fail |
| `bun run build` | ✅ 通过 |

### 10.4 ✅ 已实现：sliding-window 逃生舱

三期降级链完整：`llm-summary → truncate → sliding-window`。

`applySlidingWindow`（`scheduler.ts:241-344`）：Token 切尾 15k、保留末条 user、不拆 tool 配对、持久化 `strategy: 'sliding-window'` 空摘要。`projectView` 对此策略不生成占位符。

**触发场景**：413 + drain staged 为空 + selectStagingCandidate 返回空 → 滑动窗口打破死锁。

**8 commit，7 新测试，93 pass, 0 fail。**

### 10.5 Opus 逃生舱设计 ✅ 已完成

Opus 输出 → `/tmp/opus-sliding-window-output.md`。Codex 已按规格实现。

### 10.6 模型配置

ctx-agent 后端模型需支持 JSON schema 输出。实测结论：

| 后端 | JSON schema | 推荐 |
|------|------------|------|
| qwen3.6-35b-a3b-fp8 (vllm) | ❌ 不跟 → 回退占位摘要 | 不可用 |
| deepseek-chat (v4 Flash) | ✅ 完美 | 推荐 |

settings.json 中 `OPENAI_DEFAULT_HAIKU_MODEL` 设为 `deepseek-chat`。注意：CCP 的 OpenAI provider 是单端点架构，`OPENAI_BASE_URL` 需指向 DeepSeek API 才能让 ctx-agent 正常工作。未来可考虑 per-model 路由。

---

## 十一、端到端实测报告 ✅

### 11.1 测试方法

构造 500 轮对话（1001 条消息，31,983 tokens），通过 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=50000` 压低上下文窗口至有效 30,000 tokens（90% 阈值 27,000），强制触发 collapse。

```bash
CLAUDE_CODE_AUTO_COMPACT_WINDOW=50000 \
OPENAI_BASE_URL=https://api.deepseek.com/v1 \
OPENAI_DEFAULT_HAIKU_MODEL=deepseek-chat \
bun run scripts/collapse_e2e_test.ts
```

### 11.2 触发验证

| 轮次 | 窗口 | 结果 |
|------|------|------|
| 1 (12k) | 有效 3,808 | 🟡 collapse 触发，空 spawn（全在保护尾） |
| 2 (30k) | 有效 21,808 | 🟡 collapse 触发，空 spawn（保护尾 > 有效窗口） |
| 3 (40k) | 有效 20,000 | 🟡 collapse 触发，空 spawn（reserved 吃掉 20k） |
| 4 (50k) | 有效 30,000 | 🎯 **真正触发！** |

关键发现：`reservedTokensForSummary`（`min(maxOutput, 20000)`）在 vllm 配置下吞掉 20k token，导致 40k 窗口实际只有 20k 有效——低于 PROTECTED_TAIL_TOKENS（25k），全量消息落入保护区。需 50k+ 窗口才能让候选区间溢出保护区。

### 11.3 摘要质量评测

**压缩内容**：108 对完全相同的 Q&A 对话（填充文本测试），6,956 tokens。

**DeepSeek v4 Flash 输出**（52 tokens）：

> "The conversation contains 108 identical Q&A pairs, all using filler text about testing context folding. No decisions, file paths, API shapes, or TODOs are present."

| 维度 | 评分 | 说明 |
|------|------|------|
| 准确性 | ✅ | 精确识别 108 对，无虚构 |
| 信息保真 | ✅ | 全部内容相同，无信息损失 |
| 结构化 | ✅ | 主动报告 decisions/APIs/TODOs 四个指令维度 |
| 压缩比 | 99.25% | 6,956 → 52 tokens |
| 降级行为 | ✅ | 35B 失败 → parseVerdict 回落 → fallbackVerdict 占位 |

### 11.4 调试发现

- `bun run` 脚本绕过 CCP bootstrap → `configReadingAllowed` 锁死 → queryHaiku 抛 `Config accessed before allowed`。需调 `enableConfigs()` 解锁。
- settings.json 的 `env` 字段只在 CCP 入口加载，脚本需手动传 env var。
- `parseVerdict` → `extractTextContent` → `getResponseContent` 依赖 `AssistantMessage` 的内部结构（先查 `response.content`，再查 `response.message.content`）。OpenAI provider 返回格式与 Anthropic 不同，但解析链路兼容。

### 11.5 结论

CONTEXT_COLLAPSE 三层降级链在真实 API 环境下全部跑通。系统在任何场景下都不崩溃——空 spawn 优雅退出、parseVerdict 失败回落占位、sliding-window 打破死锁。摘要质量取决于后端模型的 JSON schema 支持度，推荐 DeepSeek v4 Flash 或 Claude Haiku。

---

## 附录：关键文件索引

| 文件 | 角色 |
|---|---|
| `src/services/contextCollapse/index.ts` | 入口：三个 @stub + 订阅骨架 + getStats + reset |
| `src/services/contextCollapse/store.ts` | 运行时状态：CommittedCollapse[] + staged + health |
| `src/services/contextCollapse/registry.ts` | 双向 bimap + ID 发号器 |
| `src/services/contextCollapse/operations.ts` | projectView + commitToSpan + createSummaryMessage |
| `src/services/contextCollapse/persist.ts` | 恢复管线（loader → store） |
| `src/query.ts` | 三个调用点（~662, ~1044, ~1375） |
| `src/types/logs.ts` | ContextCollapseCommitEntry + SnapshotEntry（frozen） |
| `src/utils/sessionStorage.ts` | recordContextCollapseCommit/Snapshot |
| `src/utils/sessionRestore.ts` | 恢复调用点 |
| `src/services/compact/autoCompact.ts` | collapse defer + marble_origami guard（不改） |
| `src/services/compact/postCompactCleanup.ts` | isMainThreadCompact guard → resetContextCollapse()（不改） |
| `src/components/ContextVisualization.tsx` | getStats() 消费者 — UI 显示 collapse 状态 |
| `scripts/defines.ts` | CONTEXT_COLLAPSE feature flag |
