# HISTORY_SNIP Fix — Implementation Plan

**日期**: 2026-06-20
**来源**: Claude Opus 设计 (thinking enabled)
**背景**: CC_Pure v2.6.11-stable.3

---

## 问题全景

HISTORY_SNIP 骨架存在但从未工作。三个具体问题：

1. **断桥** — `SnipTool.call()` 记录意图，但没有人把 tool_result 转成 `snip_boundary`。`createSnipBoundary()` 存在但零调用者。`snipCompactIfNeeded` 永远找不到 boundary。
2. **无摘要** — 模型看到的 "summary" 只是 `reason ?? "Snipped N messages"`。没有 LLM 生成的摘要，剪了就真丢了信息。
3. **双表示不一致** — 热路径用集合删除 (`removedUuids`)，UI 投影用前缀切片。两者互不兼容。

## 设计决策（已定，不复辩）

- 新 `snipExecute.ts` 负责桥接：short-id → exchange-block → removedUuids → queryHaiku 摘要 → boundary
- `query.ts` 拦截 Snip tool_result，构建并 yield boundary
- `projectSnippedView` 统一为 removedUuids 集合过滤；`createSnipBoundary` 删除
- 摘要用 `queryHaiku`（轻量），best-effort + 确定性 fallback
- Token 预算：<200 token 跳过；摘要上限 `min(512, 50% 被剪)`
- 三 commit：重构 → 接线（flag 关着） → 开启

---

## Commit 1 — 重构：统一边界表示

```
refactor: 统一 snip boundary 为 removedUuids 集合表示，删除 createSnipBoundary
```

纯重构。flag 关着时行为不变，flag 开着时纠正 `projectSnippedView` 的前缀切片 bug。

### 文件
- `snipProjection.ts` — 重写 `projectSnippedView`，删除 `createSnipBoundary` 及相关类型
- `snipCompact.ts` — 导出 `findSnipBoundary` 辅助函数 + `estimateMessageTokens`
- `snipProjection.test.ts` — 重写测试为集合语义
- 调用方扫描：`Message.tsx`、`QueryEngine.ts`、`messages.ts`

### 核心改动

1. **删除前缀切片**：删除 `SnipBoundary` 类型、`SnipBoundaryMessage`、`createSnipBoundary` 函数
2. **统一检测**：`isSnipBoundaryMessage` 改为检测 `system` + `subtype:'snip_boundary'`
3. **统一投影**：`projectSnippedView` 改为调用 `snipCompactIfNeeded` 的集合删除逻辑
4. **共享访问器**：导出 `findSnipBoundary(messages)` + `estimateMessageTokens`

### 验证
- `bun run typecheck` — 零错误，`SnipBoundary` 删除无残留引用
- `bun test src/services/compact/__tests__/`
- `grep -rn "createSnipBoundary\|SnipBoundary\b" src packages` — 仅删改文件

### 风险
- 语义翻转：从前缀切片变为集合过滤。审计所有消费者确认无依赖旧语义的代码

---

## Commit 2 — 接线：snipExecute 桥接（flag 关闭）

```
feat: 接通 SnipTool → snipExecute 桥接与 Haiku 摘要生成（flag 关闭）
```

新增桥接模块和摘要生成，全部在 `feature('HISTORY_SNIP')` 后面。构建默认 flag 仍关着。

### 文件
- `src/services/compact/snipExecute.ts` — **新文件**：4 个核心函数
- `src/services/compact/prompt.ts` — 添加 `SNIP_SUMMARY_PROMPT`
- `snipCompact.ts` — 导出 `estimateMessageTokens`
- `query.ts` — 导入 snipExecute，拦截 Snip tool_result 构建 boundary
- `SnipTool.ts` — 文档注释说明 call() 返回的是临时摘要，权威摘要在 query 侧生成

### snipExecute.ts 核心函数

```
executeSnip({messageIds, reason, store, signal, haikuOptions})
  1. short-id → exchange-block → removedUuids
  2. token-budget gate: <200 token → skip (return undefined)
  3. summary cap: min(512, removedTokens * 0.5)
  4. queryHaiku → 摘要 (best-effort)
     ├─ 成功 → 使用 Haiku 输出
     └─ 失败/超时 → 确定性 fallback (文件名+工具名+时间范围)
  5. 构建 snip_boundary system 消息
```

### query.ts 集成点

在 tool-update loop 里，Snip tool_result 返回后：
```
if (feature('HISTORY_SNIP') && update.message)
  boundary = await snipModule.maybeExecuteSnipFromToolResult(...)
  if (boundary) yield boundary
```

下一轮 query 进入时，`snipCompactIfNeeded` 消费这个 boundary，物理删除消息。

### 验证
- `bun run typecheck` — 新模块编译通过
- `bun test src/services/compact/` — 单元测试：id 解析、token 预算、fallback
- `FEATURE_HISTORY_SNIP=1 bun run dev` — 手动 snip 测试
- `bun run build && node dist/cli.js --version` — 构建产物中无 `snip_boundary` 字面量泄露

### 风险
- 孤儿 tool_result：删了 tool_use 但留了 tool_result → API 请求非法。用 exchange block 展开解决
- Haiku 延迟：await 在 tool-update loop 里。用 AbortSignal + timeout 守卫

---

## Commit 3 — 开启标志

```
chore: 启用 HISTORY_SNIP 默认构建 feature
```

一行改动。

### 文件
- `scripts/defines.ts:63` — 取消注释 `'HISTORY_SNIP',`

### 验证
- `bun run precheck` — typecheck + lint + test 全绿
- 构建产物端到端：≥30 条消息会话 → 调 Snip → boundary 出现在消息流 → 下一轮被剪消息消失 → 摘要正确
- Resume 测试：snip 后的会话恢复 → `applySnipRemovals` 正确重放
- 回归：从未 snip 的会话与 flag 关闭时的请求完全一致

### 风险
- 首次真实流量暴露。回滚只需重新注释 `defines.ts:63`，Commit 1-2 可保留
- 与 autocompact 互动：`snipTokensFreed` 已汇入 autocompact 阈值计算
- Resume 持久化：`applySnipRemovals` 已读 `snipMetadata.removedUuids`（Commit 1 统一后的表示）
