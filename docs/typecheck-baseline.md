# TypeScript Error Baseline — chore/typecheck-green

Date: 2026-06-02
Command: `bun x tsc --noEmit`
Total: **62 errors** across 22 files

---

## Group 1 — Core src/runtime errors (11 errors)

| File | Line | Error | Category |
|------|------|-------|----------|
| `src/entrypoints/cli.tsx` | 140 | `ChannelPermissionRequestNotificationSchema` not on type | Missing export |
| `src/services/acp/entry.ts` | 1,2,4 | Cannot find `@agentclientprotocol/sdk`, `./agent.js` | Missing module (ACP, gated) |
| `src/services/localVault/store.ts` | 354,355,389,429,430 | Expected 0 arguments, got 1-2 | Decompile — `Keychain.setPassword()` sig mismatch |
| `src/commands/effort/effort.tsx` | 30 | `EffortLevel` missing `"xhigh"` | Type union incomplete |
| `src/components/EffortCallout.tsx` | 64 | Same `xhigh` issue | Type union incomplete |
| `src/components/ModelPicker.tsx` | 204 | Same `xhigh` issue | Type union incomplete |

---

## Group 2 — provider / sideQuery / model-provider (0 errors)

✅ All clear — sideQuery routing and @ant/model-provider pass typecheck.

---

## Group 3 — packages/@ant/* edge packages (8 errors)

| File | Line | Error | Category |
|------|------|-------|----------|
| `packages/@ant/computer-use-swift/.../win32.ts` | 257 | `captureWindowTarget` not in `ScreenshotAPI` | Stub incomplete |
| `packages/acp-link/src/cli/command.ts` | 22-66 | Boolean/string → undefined, missing `optional` prop | Decompile — Commander.js types |

---

## Group 4 — tests (7 errors)

| File | Line | Error | Category |
|------|------|-------|----------|
| `packages/color-diff-napi/src/__tests__/color-diff.test.ts` | 75-86 | Expected 2 args, got 1 (6×) | Test interface mismatch |
| `packages/remote-control-server/src/__tests__/disconnect-monitor.test.ts` | 78 | `status` not in session init type | Stale test |

---

## Group 5 — decompile residue (36 errors)

### 5a — `ToolResultBlockParam` not exported (14 errors)
Files: `CtxInspectTool`, `DiscoverSkillsTool`, `ListPeersTool`, `MonitorTool`, `PushNotificationTool`, `REPLTool`, `SendUserFileTool`, `SleepTool`, `SnipTool`, `SubscribePRTool`, `SuggestBackgroundPRTool`, `TerminalCaptureTool`, `VerifyPlanExecutionTool`, `WebBrowserTool`, `WorkflowTool`
→ `src/Tool.ts` defines `ToolResultBlockParam` locally but doesn't export it. Add one `export` keyword.

### 5b — Missing `searchExtraTools` module (4 errors)
Files: `ExecuteTool/ExecuteTool.ts`, `SearchExtraToolsTool/SearchExtraToolsTool.ts`
→ `src/utils/searchExtraTools.ts` and `src/services/searchExtraTools/toolIndex.ts` don't exist. Create stubs.

### 5c — Missing `CORE_TOOLS` export (1 error)
File: `SearchExtraToolsTool/prompt.ts`
→ `src/constants/tools.ts` lacks `CORE_TOOLS`. Add the missing constant.

### 5d — TCP type mismatches in SendMessageTool (5 errors)
File: `SendMessageTool/SendMessageTool.ts` (lines 636,662,722,872,873)
→ `peerType` union `"other" | "bridge" | "uds"` doesn't include `"tcp"`. `parseTcpTarget` missing from `peerAddress`.

### 5e — `udsMessaging` / `bridge/peerSessions` missing exports (3 errors)
File: `ListPeersTool` — `getUdsMessagingSocketPath`, `formatUdsAddress`, `listPeers`, `listBridgePeers`
→ Stub the missing exports or add to existing stub files.

### 5f — `updateSessionInit` missing `status` (1 error)
See Group 4 above — test uses stale interface.

---

## Action Plan (Priority Order)

### Quick wins (high impact, low risk):
1. **Export `ToolResultBlockParam`** from `src/Tool.ts` — fixes 14 errors in one edit
2. **Add `"xhigh"` to Effort union types** (3 components) — fixes 3 core errors
3. **Fix `color-diff` test** — update argument count (6 errors)

### Medium:
4. **Create stubs** for `searchExtraTools.ts`, `toolIndex.ts` — fixes 4 errors
5. **Add `CORE_TOOLS` export** — fixes 1 error
6. **Fix `SendMessageTool` TCP types** — add `"tcp"` to union, stub `parseTcpTarget`

### Deferred (gated features, low priority):
7. **ACP module** (`@agentclientprotocol/sdk`) — feature-gated, install as devDep or stub
8. **`ChannelPermissionRequestNotificationSchema`** — add export or stub
9. **localVault Keychain sig** — fix method signatures on stub
10. **acp-link Commander.js types** — add missing `optional` field
11. **computer-use-swift win32** — add `captureWindowTarget` to interface (win32-only)
