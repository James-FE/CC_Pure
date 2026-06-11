# Claude Code: Light and Shadow

> **Subtitle:** Reverse Engineering, Defense-in-Depth, and Self-Serving Adaptation of Anthropic's Telemetry System
> 
> **Author:** James Feng (Based on CC_Pure codebase reverse analysis, June 2026)
> 
> **Tags:** `Reverse Engineering` `Telemetry` `Privacy` `GrowthBook` `OpenTelemetry` `Data Analysis`

---

## Table of Contents

1. [Preface: Why This Article](#1-preface)
2. [The Light: An Industrial-Grade Data Factory](#2-the-light)
3. [The Shadow: Where the Data Goes](#3-the-shadow)
4. [Anatomy: Five-Layer Architecture of the Telemetry System](#4-anatomy)
5. [Defense: What We Did](#5-defense)
6. [Making It Yours: How to Make This System Serve You](#6-making-it-yours)
7. [Appendix: Event Dictionary](#7-appendix)

---

## 1. Preface

Claude Code (internal codename "tengu") is Anthropic's terminal-based AI coding assistant. It is more than just a command-line tool — it is a complete **data collection and analysis infrastructure**. Every time you enter a command, call a tool, or trigger an API request, dozens of telemetry events are captured, sampled, routed, and reported in the background.

This article is based on a deep code audit of **CC_Pure** (the decompiled and restored version of Claude Code), fully dissecting this telemetry system:

- What does it collect?
- Where does the data flow?
- How did we discover and defend against it?
- More importantly, **how do we turn it into our own利器 (sharp tool)**?

> **Core Conclusion:** Anthropic's telemetry infrastructure is itself an industrial-grade data engineering example worth studying. We don't need to destroy it — we need to **take control of it**.

---

## 2. The Light

### 2.1 Engineering Design Elegance

Claude Code's telemetry system is not a simple instrumentation + reporting setup. It is a layered architecture:

```
logEvent()
  ├── Local JSONL Write (our defense layer)
  ├── Event Queue (buffer when sink is uninitialized)
  ├── GrowthBook Dynamic Sampling (cloud-controlled sampling engine)
  ├── Datadog Monitoring (operational alerts)
  └── 1P Event Reporting (Anthropic internal BigQuery analysis)
```

**Highlight 1: Zero-Dependency Entry Design**

The `logEvent()` function (`src/services/analytics/index.ts`) has no module-level dependencies. All events first enter a queue, and are only routed to the backend after `attachAnalyticsSink()` is called during application initialization. This design avoids circular dependencies and makes testing extremely easy.

```typescript
// Elegant: zero-dependency entry point
export function logEvent(eventName, metadata) {
  // ① Local write (our injection point)
  writeLocalEvent(eventName, metadata)
  // ② If sink is not ready, enqueue; otherwise send directly
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: false })
    return
  }
  sink.logEvent(eventName, metadata)
}
```

**Highlight 2: GrowthBook Dynamic Experiment Platform**

The entire project's feature flag system is built on GrowthBook. This is not a simple `if (feature_enabled)` — it is a complete A/B experimentation platform:

- **Remote eval:** The server pre-computes each feature's value, and the client uses it directly, no local rule engine needed
- **Disk cache + in-session refresh:** After the first fetch, writes to `~/.claude.json`; subsequent processes start with cached data; session updates are pushed via `onGrowthBookRefresh`
- **Experiment exposure tracking:** Each accessed feature automatically records experiment assignment events to the 1P event pipeline
- **Dynamic configuration (JSON config):** Not just toggle switches, but also supports complex JSON configurations (e.g., event sampling rates, batch parameters, sink kill switches)

The `src/services/analytics/growthbook.ts` file is **1256 lines** long, handling details such as workarounds for the remote eval response format, env-var overrides, config overrides, refresh signaling mechanisms, etc.

**Highlight 3: ToolSearchTool — The Core of the RL Data Factory**

`ToolSearchTool` is not just a tool search feature — it is a **reinforcement learning data collection machine**:

```typescript
// Search scoring weights (precisely tuned parameters)
if (parsed.parts.includes(term)) {
  score += parsed.isMcp ? 12 : 10    // MCP tool name exact match has higher weight
} else if (parsed.parts.some(part => part.includes(term))) {
  score += parsed.isMcp ? 6 : 5      // Partial match
}
// searchHint match
score += 4
// Description match
score += 2
```

Each search reports a `tengu_tool_search_outcome` event, containing:
- `query`: The user's search term
- `queryType`: `select` or `keyword`
- `matchCount`: Number of matches
- `totalDeferredTools`: Total deferred tools
- `hasMatches`: Whether there are matches

This data allows Anthropic to **quantitatively analyze how the model uses tools**, thereby continuously optimizing tool descriptions, search algorithms, and scoring weights.

**Highlight 4: Multi-Layer PII Protection**

Privacy protection designs are found throughout the code:

- `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` type marker — forces developers to verify they are not uploading code/paths
- `sanitizeToolNameForAnalytics()` — MCP tool names (which may expose user configuration) are replaced with `mcp_tool`
- `stripProtoFields()` — PII-tagged fields only reside in 1P privileged columns, not in general Datadog
- `getFileExtensionForAnalytics()` — Only uploads file extensions, not full paths
- `getUserBucket()` — User ID hash bucketing, de-anonymizes counting without exposing identity

### 2.2 Event System Panorama

Through code audit, we counted **190+ `logEvent()` calls**, distributed across 52 files. Major event categories:

| Category | Event Count | Representative Events |
|----------|-------------|----------------------|
| API Queries | ~20 | `tengu_query_error`, `tengu_api_success`, `tengu_token_budget_completed` |
| Tool Usage | ~15 | `tengu_tool_search_outcome`, `tengu_bash_tool_used` |
| Permission Decisions | ~10 | `tengu_tool_use_granted`, `tengu_tool_use_rejected` |
| Authentication/OAuth | ~15 | `tengu_oauth_success`, `tengu_oauth_token_refresh_failure` |
| Session Lifecycle | ~10 | `tengu_started`, `tengu_exit`, `tengu_init` |
| Compaction/Memory | ~5 | `tengu_auto_compact_succeeded`, `tengu_orphaned_messages_tombstoned` |
| Experiment/A/B | ~8 | `tengu_willow_mode`, GrowthBook assignment |
| Bridge/Remote | ~15 | `tengu_bridge_message_received`, `tengu_ws_transport_reconnected` |
| Migration | ~8 | `tengu_opus_to_opus1m_migration` |
| Telemetry Self-Monitoring | ~3 | `analytics_sink_attached` |

### 2.3 Data Factory: Four Parallel Pipelines

Anthropic effectively runs **four independent data pipelines**:

1. **Datadog (Operations)**: Whitelist-based, only sends ~40 predefined events to Datadog, used for SRE alerts such as API error rates, OAuth failure rates
2. **1P Event Logging (Analytics)**: Based on OpenTelemetry SDK Logs, **all events** are reported to Anthropic's BigQuery via `/api/event_logging/batch`, the core analytics pipeline
3. **GrowthBook (Experiments)**: Feature flag assignments + experiment exposure events, reported independently, used for A/B test result evaluation
4. **Customer OTLP (Customer Telemetry)**: Optional enterprise customer OTLP export (metrics/logs/traces), controlled by `CLAUDE_CODE_ENABLE_TELEMETRY`

---

## 3. The Shadow

### 3.1 Breadth of Data Collection

Let's look honestly: what does Claude Code **actually collect**?

```
Each startup:
  ✓ OS version, terminal type, package manager list
  ✓ Hash of Git repository remote URL ("rh" field)
  ✓ User subscription level (Free/Pro/Max/Team/Enterprise)
  ✓ Whether it's a CI environment, GitHub Action type

Each API query:
  ✓ Model name used, beta list
  ✓ Token consumption, context window size
  ✓ Whether a fallback model was triggered
  ✓ Attachment comparison before and after query

Each tool call:
  ✓ Tool name, whether it succeeded
  ✓ File extension (not the path, but enough to infer project type)
  ✓ Bash command type (diff/grep/sed, etc.)
  ✓ Permission decision (always allow / reject / ask)

Each session:
  ✓ Startup count, usage duration
  ✓ Compaction frequency, number of orphaned messages
  ✓ KAIROS (background agent) active status
```

### 3.2 Technical Transparency

Anthropic is not doing this secretly. The design patterns in the code indicate:

1. **All telemetry is centrally managed under `src/services/analytics/`**, with clear module boundaries
2. **Privacy classification is explicit** (`AnalyticsMetadata_I_VERIFIED_...` type markers)
3. **Opt-out mechanisms are provided** (`DISABLE_TELEMETRY` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`)

However, the distance from "backdoor" to "data factory" is not far. This infrastructure, if abused (or hit by a supply chain attack), could easily become:

- A code snippet collector (bypassing file path truncation, uploading content directly)
- A user behavior profiler (inferring work habits through token consumption patterns)
- An engineering structure sniffer (inferring tech stack through file extension statistics)

### 3.3 "Anomalies" We Found

During the CC_Pure code audit, we noticed several unusual aspects:

1. **`USER_TYPE === 'ant'` conditional branches:** There are **50+ places** checking whether the user is an Anthropic internal employee. The internal version can see additional debug information, tools (ConfigTool, TungstenTool, REPLTool), and error logs. This is not a security issue, but it shows the difference between the "internal version" and "external version" is larger than documented.

2. **ToolSearchTool's RL scoring weights:** The fine-grained scoring system of `12/10/6/5/4/3/2` is not hand-tuned — it suggests **continuous A/B experimentation and RL optimization** running behind the scenes.

3. **Depth of GrowthBook dynamic configuration:** Not just feature flags, but also event sampling rates, batch sizes, sink kill switches, and even `tengu_max_version_config` — a switch to remotely kill specific versions.

---

## 4. Anatomy: Five-Layer Architecture of the Telemetry System

### Layer 1: Event Generation

Events are generated throughout the code via `logEvent('event_name', metadata)`. Event names follow the `tengu_<domain>_<action>` naming convention.

```typescript
// Typical event generation point
logEvent('tengu_tool_search_outcome', {
  query, queryType, matchCount, totalDeferredTools, maxResults, hasMatches
})
```

The metadata type constraint is `{ [key: string]: boolean | number | undefined }` — strings are prohibited to prevent accidental code uploads.

### Layer 2: Event Enrichment

Before entering the sink, each event is enriched by `getEventMetadata()`, injecting:

- **Session context:** sessionId, clientType, isInteractive
- **Environment context:** OS, terminal, package manager, CI detection
- **Model information:** Currently used model, betas, provider
- **User information:** userType, subscriptionType, userBucket
- **Process metrics:** RSS, heapUsed, cpuUsage (only in the Datadog path)

`src/services/analytics/metadata.ts` is **966 lines** long, serving as the core of this enrichment engine.

### Layer 3: Sampling & Filtering

Events go through multiple layers of filtering before being sent:

```
1. isAnalyticsDisabled()  ← Master switch
   ├── NODE_ENV === 'test'?
   ├── 3P provider (Bedrock/Vertex/Foundry)?
   └── isTelemetryDisabled()?
       ├── DISABLE_TELEMETRY?
       └── CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?

2. shouldSampleEvent()  ← GrowthBook dynamic sampling
   └── tengu_event_sampling_config (JSON config, sets sampling rate by event name)

3. isSinkKilled('datadog' | 'firstParty')  ← Kill individual sinks
   └── tengu_frond_boric GrowthBook config

4. Datadog additional: Whitelist (DATADOG_ALLOWED_EVENTS) + skip non-production environments
```

### Layer 4: Event Routing

`logEventImpl()` in `sink.ts` dispatches events to two backends:

```
logEventImpl(eventName, metadata)
  ├── shouldTrackDatadog()? → trackDatadogEvent()
  │     └── POST https://http-intake.logs.datadoghq.com/api/v2/logs
  │         Batch size: 100, Flush interval: 15s
  │
  └── logEventTo1P() → FirstPartyEventLoggingExporter
        └── POST https://api.anthropic.com/api/event_logging/batch
             Batch size: 200 (configurable), Flush interval: 10s (configurable)
```

### Layer 5: Persistence & Retry

The 1P event exporter (`firstPartyEventLoggingExporter.ts`, **806 lines**) has industrial-grade reliability:

- **Disk persistence:** Failed events are written to `~/.claude/telemetry/1p_failed_events.{sessionId}.{batchId}.json`
- **Exponential backoff retry:** `baseDelay * attempts²`, up to 30s max, up to 8 attempts
- **Cross-process recovery:** Retries failed files from previous sessions on startup
- **Hierarchical failure handling:** One batch fails → short-circuit remaining batches → all enqueued for retry
- **Concurrency safety:** Append-based writes instead of full writes, avoiding overwrites of concurrent events

---

## 5. Defense: What We Did

### 5.1 Defense-in-Depth Strategy

Our defense strategy is not to "turn off telemetry" — that would lose the opportunity to learn from this system. Instead, we **insert a local branch at the very front of the telemetry pipeline**:

```
                  logEvent()
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
[Local JSONL]     [Datadog]     [Anthropic 1P]
  Always runs       Can be         Can be
  Your own data     disabled       disabled
                    Ops data       BigQuery analytics
```

**Key changes (only 3 files, no tool code modified):**

1. **`src/services/analytics/localSink.ts`** (54-line new file)
   ```typescript
   // Append events to ~/.claude/local_analytics.jsonl
   export function writeLocalEvent(eventName, metadata) {
     const line = JSON.stringify({
       ts: new Date().toISOString(),
       event: eventName,
       ...metadata,
     }) + '\n'
     fs.appendFileSync(LOCAL_ANALYTICS_FILE, line, 'utf-8')
   }
   ```

2. **`src/services/analytics/index.ts`** (Insert 3 lines at the `logEvent()` entry point)
   ```typescript
   // Execute before all upstream sinks
   const { writeLocalEvent } = require('./localSink.js')
   writeLocalEvent(eventName, metadata)
   ```

3. **`scripts/analyze_analytics.py`** (Analysis script)

### 5.2 Why This Approach Is Better Than Just Disabling Telemetry

| Approach | Pros | Cons |
|----------|------|------|
| `DISABLE_TELEMETRY=1` | Simple, one-click disable | Loses all data, learns nothing |
| Directly delete analytics code | Thorough | Breaks code structure, requires re-modification with each update |
| **Our approach: Frontend fork** | Preserves full infrastructure, data belongs to you | Requires ~200 extra lines + analysis tools |

### 5.3 .gitignore Protection

```gitignore
# Local analytics data (never upload)
*.jsonl
.claude/
```

Ensures local telemetry data is never accidentally committed to the repository.

---

## 6. Making It Yours

### 6.1 Local Data File

`~/.claude/local_analytics.jsonl` — one JSON event per line:

```json
{"ts":"2026-06-03T10:15:23.456Z","event":"tengu_started","sessionId":"abc123"}
{"ts":"2026-06-03T10:15:24.789Z","event":"tengu_bash_tool_used","toolName":"Bash"}
{"ts":"2026-06-03T10:15:25.012Z","event":"tengu_api_success","model":"claude-sonnet-4-20250514"}
```

### 6.2 Analysis Scripts

```bash
# View event statistics report
python3 scripts/analyze_analytics.py

# Real-time event stream tracking
tail -f ~/.claude/local_analytics.jsonl

# Search for specific events
grep "tengu_query_error" ~/.claude/local_analytics.jsonl | python3 -m json.tool

# Count usage by day
grep "tengu_started" ~/.claude/local_analytics.jsonl | wc -l
```

### 6.3 What You Can Analyze

| Analysis Dimension | Data Source | Questions Answered |
|--------------------|-------------|-------------------|
| Tool usage frequency | `tengu_tool_use_*` | What tools do I use most? What's the Bash share? |
| Model fallback rate | `tengu_model_fallback_triggered` | How stable is my API? |
| Context compaction frequency | `tengu_auto_compact_succeeded` | Do my conversations frequently exceed the window? |
| API error types | `tengu_query_error` + `http_status` | Which error types are most common? |
| Session duration/frequency | `tengu_started` / `tengu_exit` | How many times per day? How long each session? |
| Tool search behavior | `tengu_tool_search_outcome` | Can the model correctly find tools? |

### 6.4 Advanced: Expanding Analysis

Because the local JSONL contains full metadata for all events, you can build:

1. **Personal usage profile:** Statistics on most used models, tool combinations, operation patterns
2. **Cost analysis:** Combine token consumption events to estimate daily API costs
3. **Efficiency dashboard:** Pandas/Streamlit visualization, real-time CCB usage monitoring
4. **Anomaly detection:** Monitor error rate spikes, unusual fallback patterns, etc.

### 6.5 Best Practices Learned from Anthropic

This telemetry system itself is a textbook case:

1. **Zero-dependency entry + lazy binding:** `logEvent()` has no dependencies, sink is injected lazily via `attachAnalyticsSink()` — suitable for any system needing a pluggable backend
2. **Multi-layer filter chain:** Master switch → sampling → sink kill switch — flexible and remotely controllable
3. **Disk fallback + exponential backoff:** Events are not lost even if the network fails
4. **Privacy type system:** TypeScript `never` types + marker patterns enforce code review
5. **GrowthBook integration pattern:** Turning feature flags into data collection tools

---

## 7. Appendix: Event Dictionary

The following are all telemetry events discovered during the code audit (representative subset):

### API & Query

| Event Name | Description |
|------------|-------------|
| `tengu_query_error` | API query error |
| `tengu_api_success` | API call success |
| `tengu_model_fallback_triggered` | Model downgrade triggered |
| `tengu_max_tokens_escalate` | Token limit triggered |
| `tengu_token_budget_completed` | Token budget exhausted |
| `tengu_query_before_attachments` | Pre-query attachment state |
| `tengu_query_after_attachments` | Post-query attachment state |
| `tengu_streaming_tool_execution_used` | Streaming tool execution enabled |
| `tengu_streaming_tool_execution_not_used` | Streaming tool execution not enabled |
| `tengu_post_autocompact_turn` | Conversation turn after auto-compaction |

### Tool Usage

| Event Name | Description |
|------------|-------------|
| `tengu_tool_search_outcome` | Tool search results (RL data) |
| `tengu_bash_tool_used` | Bash tool invoked |
| `tengu_tool_use_success` | Tool call success |
| `tengu_tool_use_error` | Tool call error |
| `tengu_tool_use_granted_in_prompt_permanent` | Tool permission permanently granted |
| `tengu_tool_use_granted_in_prompt_temporary` | Tool permission temporarily granted |
| `tengu_tool_use_rejected_in_prompt` | Tool permission rejected |

### Session Lifecycle

| Event Name | Description |
|------------|-------------|
| `tengu_started` | Startup |
| `tengu_init` | Initialization complete |
| `tengu_exit` | Exit |
| `tengu_cancel` | User cancellation |
| `tengu_auto_compact_succeeded` | Auto-compaction successful |
| `tengu_orphaned_messages_tombstoned` | Orphaned messages cleaned up |

### OAuth & Authentication

| Event Name | Description |
|------------|-------------|
| `tengu_oauth_success` | OAuth login success |
| `tengu_oauth_error` | OAuth error |
| `tengu_oauth_token_refresh_failure` | Token refresh failure |
| `tengu_oauth_token_refresh_success` | Token refresh success |
| `tengu_oauth_flow_start` | OAuth flow started |

### Telemetry Self-Monitoring

| Event Name | Description |
|------------|-------------|
| `analytics_sink_attached` | Telemetry sink connected |
| `tengu_bridge_message_received` | Bridge message received |
| `tengu_ws_transport_reconnected` | WebSocket reconnected |

---

> **Final words:** The existence of this telemetry system is not the problem — the problem is the sovereignty of the data. Our modification proves: **you can pull data ownership from the cloud back to local without destroying the infrastructure**. This code itself is the best teaching material: learn from Anthropic's engineering practices, take control of your data, and then use that data to optimize your own workflow.
> 
> The light lies in the engineering elegance, the shadow lies in the absence of sovereignty. We choose to illuminate the shadow, not to turn off the lights.

---

*Document version: v1.0 | Last updated: 2026-06-03*
