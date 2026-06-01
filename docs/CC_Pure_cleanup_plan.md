# CC_Pure 遥测清理方案

> 项目：claude-code-best (ccb) v2.1.888 → CC_Pure
> 仓库：https://github.com/GhostDragon124/CC_Pure
> 审计报告：docs/telemetry-cleanup-audit.md

---

## 一、背景：ccb 里有哪些遥测系统

ccb 是从 Anthropic 官方 Claude Code 反编译还原的项目。源码中包含 6 个遥测系统：

| # | 系统 | 数据流向 | 默认状态 |
|---|------|---------|---------|
| 1 | **Datadog 日志** | `api.datadoghq.com` | ✅ ccb 已清空端点/Token，默认禁用 |
| 2 | **Sentry 错误上报** | `sentry.io` | ✅ ccb 未配置 DSN，默认 no-op |
| 3 | **OpenTelemetry** | 用户自配 OTLP 端点 | ✅ 需显式设 `CLAUDE_CODE_ENABLE_TELEMETRY=1` |
| 4 | **1P Event Logging** | `api.anthropic.com/api/event_logging/batch` | 🔴 默认启用 |
| 5 | **GrowthBook 远程配置** | `api.anthropic.com/` | 🔴 默认启用 |
| 6 | **BigQuery Metrics** | `api.anthropic.com/api/claude_code/metrics` | 🔴 默认启用 |

### 实测验证（strace 网络抓包）

```
测试：strace -f -e trace=network ccb --print -p "hello"
```

| 环境变量 | `api.anthropic.com` 连接数 |
|----------|--------------------------|
| 无防护 | 1 次 |
| `DISABLE_TELEMETRY=1` | **1 次**（未完全阻断！） |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | **0 次** ✅ |

结论：**`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 是唯一能完全阻断的配置**。

---

## 二、清理方案：纵深防御（4 层）

核心思路：**环境变量做入口防御 + 源码级切断关键初始化路径**，不做"自欺欺人"式的 `return true`。

### 第 1 层：ccb wrapper（配置防御）

**文件**：`~/.local/bin/ccb`

```bash
#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
# CC_Pure: 防御层 — 阻断所有非必要网络流量（遥测、自动更新等）
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
exec bun /home/spark/workspace/claude-code-best/dist/cli.js "$@"
```

**原理**：该环境变量触发 `privacyLevel = 'essential-traffic'`，使：
- `isTelemetryDisabled()` → `true`
- `isAnalyticsDisabled()` → `true`（因为 `isTelemetryDisabled()` 为 true）
- 从而 Datadog、1P Event Logging、BigQuery Metrics 全部失效

### 第 2 层：init.ts — 切断启动时遥测初始化

**文件**：`src/entrypoints/init.ts`

**改动 A**（约 L95-106）：注释掉 GrowthBook + 1P Event Logging 的动态 import 和初始化：

```typescript
// 改前：
void Promise.all([
  import('../services/analytics/firstPartyEventLogger.js'),
  import('../services/analytics/growthbook.js'),
]).then(([fp, gb]) => {
  fp.initialize1PEventLogging()
  gb.onGrowthBookRefresh(() => {
    void fp.reinitialize1PEventLoggingIfConfigChanged()
  })
})

// 改后：
// CC_Pure: GrowthBook + 1P Event Logging 已永久禁用
// (原代码保留以供参考)
// void Promise.all([...]).then(...)
```

**原因**：即使 `isAnalyticsDisabled()` 返回 true，这段代码仍会**加载模块并连接 GrowthBook**。实测中 `DISABLE_TELEMETRY=1` 下仍有 1 次 `api.anthropic.com` 连接，很可能就是这一段绕过的。

**改动 B**（L292）：`doInitializeTelemetry()` 函数体开头加 early return：

```typescript
// 改前：
async function doInitializeTelemetry(): Promise<void> {
  if (telemetryInitialized) { return }
  telemetryInitialized = true
  try { await setMeterState() } catch ...

// 改后：
async function doInitializeTelemetry(): Promise<void> {
  // CC_Pure: 遥测已完全禁用
  return;
  // ... 原代码保留
```

**原因**：`setMeterState()` 会动态 import `~400KB` 的 OpenTelemetry SDK，即使最终不导出数据也不该加载。

### 第 3 层：sinks.ts — 不挂载遥测事件管道

**文件**：`src/utils/sinks.ts`

```typescript
// 改前：
export function initSinks(): void {
  initializeErrorLogSink()
  initializeAnalyticsSink()   // ← 挂载遥测管道
}

// 改后：
export function initSinks(): void {
  initializeErrorLogSink()
  // CC_Pure: Analytics sink 已永久禁用
  // initializeAnalyticsSink()
}
```

**原因**：`initializeAnalyticsSink()` 会把所有 `logEvent("tengu_xxx")` 调用路由到 Datadog + 1P Event Logging。注释掉后，所有 `logEvent()` 调用变成空操作（事件排队但永不 flush）。

注意：`initializeErrorLogSink()` 保留——它只写本地错误日志，不涉及网络。

### 第 4 层：main.tsx — 不初始化 Analytics Gate

**文件**：`src/main.tsx` L691

```typescript
// 改前：
void initializeAnalyticsGates();

// 改后：
// CC_Pure: Analytics gate 初始化已永久禁用
// void initializeAnalyticsGates();
```

**原因**：`initializeAnalyticsGates()` 调用 GrowthBook 的 `checkStatsigFeatureGate_CACHED_MAY_BE_STALE()`，会读取本地缓存的远程配置。虽然第 2 层已切断 GrowthBook 的初始化，但为防御纵深也注释掉。

---

## 三、不改的文件及原因

### `src/services/analytics/config.ts` — 不修改

**该文件保持原样**，`isAnalyticsDisabled()` 仍为条件判断：

```typescript
export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
    isTelemetryDisabled()
  )
}
```

**不做** `return true` 硬编码。原因：
1. 第 1 层（环境变量）已经让它在正常运行时返回 true
2. 硬编码 `return true` 是"自欺欺人"——改返回值但不改调用逻辑
3. 保留原逻辑可以让后续维护者理解原始设计意图

### 其他不修改的文件

- `src/services/analytics/growthbook.ts` — 1256 行，初始化入口已在 init.ts 切断
- `src/services/analytics/firstPartyEventLogger.ts` — 449 行，同上
- `src/utils/telemetry/*` — 初始化入口已在 init.ts 切断
- `package.json`、`build.ts`、`tsconfig.json` — 完全不碰
- 所有功能代码（工具、API、UI、Bridge、Daemon） — 完全不碰

---

## 四、改动汇总

| 文件 | 改动行数 | 类型 |
|------|---------|------|
| `~/.local/bin/ccb` | +1 行 | 配置（环境变量） |
| `src/entrypoints/init.ts` | ~20 行注释 | 源码（切断初始化） |
| `src/utils/sinks.ts` | 1 行注释 | 源码（切断管道） |
| `src/main.tsx` | 1 行注释 | 源码（切断门控） |
| `src/services/analytics/config.ts` | **不修改** | — |

**总计：3 个源文件，4 处注释级改动。**

---

## 五、验证方法

```bash
# strace 网络抓包
strace -f -e trace=network -o /tmp/ccb_test.log \
  ccb --print --dangerously-skip-permissions -p "say hello" 2>&1

# 检查是否有 api.anthropic.com 连接
grep "api.anthropic" /tmp/ccb_test.log
# 期望输出：（空）— 零连接
```
