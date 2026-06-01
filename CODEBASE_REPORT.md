# Claude Code 代码库架构报告

> 本报告由 AI 自动生成，基于对源代码的全面探索。

---

## 一、整体目录结构

```
/home/spark/workspace/claude-code/
├── src/                    # 主源代码目录 (~2800个文件)
│   ├── entrypoints/        # 入口点 (cli.tsx, init.ts)
│   ├── screens/            # 屏幕/UI组件 (REPL.tsx 等)
│   ├── components/         # React组件 (170+个)
│   ├── tools/              # 工具实现 (61个工具目录)
│   ├── tools/shared/       # 工具共享代码
│   ├── services/           # 服务层
│   │   ├── api/             # API客户端 (Anthropic/OpenAI/Gemini)
│   │   ├── mcp/             # MCP服务器管理
│   │   ├── compact/         # 上下文压缩
│   │   └── analytics/      # 分析/遥测
│   ├── state/               # 状态管理
│   ├── hooks/               # React hooks (100+个)
│   ├── bridge/              # 远程控制/Bridge模式
│   ├── daemon/              # Daemon模式
│   ├── voice/               # 语音模式
│   ├── utils/               # 工具函数
│   ├── types/               # TypeScript类型定义
│   ├── context.ts           # 系统上下文构建
│   ├── query.ts             # 核心查询函数
│   ├── main.tsx             # CLI主逻辑 (~4680行)
│   └── replLauncher.ts      # REPL启动器
├── packages/                # 内部包 (@ant/*)
│   ├── ink/                 # Ink终端UI框架
│   ├── computer-use-*        # 屏幕操控相关
│   └── claude-for-chrome-mcp/
├── scripts/                 # 构建脚本
│   ├── dev.ts               # Dev模式入口
│   ├── defines.ts           # MACRO定义
│   └── build.ts             # 生产构建
├── tests/                    # 测试目录
├── docs/                     # 文档 (Mintlify)
└── vendor/                   # 第三方库源码
```

---

## 二、入口点与启动流程

### 2.1 多层入口架构

**`src/entrypoints/cli.tsx`** 是真正的入口，按优先级处理多条快速路径：

| 参数/命令 | 行为 |
|-----------|------|
| `--version` / `-v` | 零导入路径，直接输出版本号 |
| `--dump-system-prompt` | feature-gated，输出系统提示词 |
| `--claude-in-chrome-mcp` / `--chrome-native-host` | Chrome集成 |
| `--computer-use-mcp` | 屏幕操控MCP服务器 |
| `--daemon-worker=<kind>` | Daemon工作进程 |
| `remote-control` / `rc` / `bridge` | 远程控制模式 |
| `daemon` | Daemon守护进程模式 |
| `ps` / `logs` / `attach` / `kill` | 后台会话管理 |
| `--tmux` + `--worktree` | tmux工作树模式 |
| **默认** | 加载 `main.tsx` 启动完整CLI |

**`src/main.tsx`** (~4680行) 是CLI主逻辑：
- Commander.js CLI定义，注册大量子命令 (`mcp`, `server`, `ssh`, `auth`, `agents` 等)
- 权限检查、MCP初始化、会话恢复
- REPL/Headless模式分发
- 预加载MDM设置、Keychain凭证

### 2.2 动态导入优化冷启动

```typescript
// 只有在需要时才加载模块
if (args[0] === 'ps') {
  const { psHandler } = await import('../cli/bg.js')
  await psHandler(args.slice(1))
}
```

---

## 三、模块系统与导入导出

### 3.1 ESM + TSX

- `"type": "module"` 启用ESM
- TSX文件使用 React JSX 转换
- 路径别名: `src/*` 映射到 `./src/*`

### 3.2 条件导入（Feature Gate）

使用 `feature()` 进行代码消除（Tree Shaking）：

```typescript
// 方法1: 条件模块加载
const coordinatorModeModule = feature("COORDINATOR_MODE")
  ? require("./coordinator/coordinatorMode.js")
  : null

// 方法2: 工具的条件导入
const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null
```

### 3.3 循环依赖处理

使用 `require()` 延迟导入打破循环依赖：

```typescript
// Lazy require 打破循环: tools.ts → TeamCreateTool → ... → tools.ts
const getTeamCreateTool = () =>
  require('./tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool
```

---

## 四、核心循环：输入到API调用

### 4.1 数据流向

```
用户输入 → REPL.tsx → processUserInput() → query() → API调用
                ↓                           ↓
          工具权限检查              Anthropic API 流式响应
                ↓                           ↓
          React组件渲染              工具执行 → 结果返回
```

### 4.2 关键文件

| 文件 | 职责 |
|------|------|
| `src/screens/REPL.tsx` (~278KB) | 交互式终端UI，处理用户输入 |
| `src/query.ts` | 核心查询函数，处理流式响应和工具调用 |
| `src/QueryEngine.ts` | 高层编排器，管理会话状态和压缩 |
| `src/utils/processUserInput/processUserInput.ts` | 输入处理和命令解析 |

### 4.3 消息类型

```typescript
type Message = {
  type: 'user' | 'assistant' | 'system' | 'attachment' | 'progress' | ...
  uuid: UUID
  message?: {
    role?: string
    content?: MessageContent  // ContentBlock[]
    usage?: BetaUsage
  }
  toolUseResult?: unknown
}
```

---

## 五、工具系统

### 5.1 工具接口

每个工具是一个包含以下属性的对象：

```typescript
type Tool<Input, Output, P> = {
  name: string
  aliases?: string[]                    // 别名
  inputSchema: z.ZodType                // 输入验证
  description(): Promise<string>
  call(): Promise<ToolResult>
  prompt(): Promise<string>

  // 工具特性
  isConcurrencySafe(): boolean           // 是否可并发
  isReadOnly(): boolean                 // 是否只读
  isDestructive?(): boolean             // 是否破坏性
  interruptBehavior?(): 'cancel' | 'block'

  // UI渲染
  renderToolUseMessage()
  renderToolResultMessage()
  renderToolUseProgressMessage?()
}
```

### 5.2 工具注册 (`src/tools.ts`)

```typescript
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    BashTool,
    FileEditTool,
    FileReadTool,
    WebSearchTool,
    GrepTool,
    GlobTool,
    MCPTool,
    TaskCreateTool,
    // ... 60+ 工具
  ]
}
```

工具通过 `buildTool()` 工厂函数创建，自动填充默认值。

### 5.3 工具执行 (`src/services/tools/toolOrchestration.ts`)

工具执行器支持**并发执行**：
1. 读取操作可并发执行
2. 写入操作串行执行
3. 工具分区逻辑检查 `isConcurrencySafe()`

```typescript
export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate>
```

### 5.4 主要工具列表

| 工具 | 功能 |
|------|------|
| BashTool | 执行Shell命令 |
| FileEditTool | 编辑文件 |
| FileReadTool | 读取文件 |
| WebSearchTool | 网络搜索 |
| GrepTool | 文本搜索 |
| GlobTool | 文件模式匹配 |
| AgentTool | 启动子代理 |
| MCPTool | 调用MCP服务器工具 |
| TaskCreateTool | 创建任务 |

---

## 六、状态管理

### 6.1 双层状态架构

**1. 模块级单例 (`src/bootstrap/state.ts`)**

存储会话级全局状态（~100+ 字段）：

```typescript
type State = {
  originalCwd: string
  projectRoot: string
  sessionId: SessionId
  mainLoopModelOverride: ModelSetting
  totalCostUSD: number
  cwd: string
  // ...
}
```

**2. React状态 (`src/state/AppState.tsx`)**

使用 Zustand-like 模式：

```typescript
type Store<T> = {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void
}
```

**AppState 内容：**

```typescript
type AppState = {
  settings: SettingsJson
  messages: Message[]
  tools: Tools
  toolPermissionContext: ToolPermissionContext
  mcpClients: MCPServerConnection[]
  // ...
}
```

### 6.2 访问模式

```typescript
// React组件中
const messages = useAppState(s => s.messages)
const setMessages = useSetAppState()

// 非React代码
const { getState, setState } = appStateStore
```

---

## 七、API层

### 7.1 多Provider支持

```typescript
type APIProvider = 'anthropic' | 'bedrock' | 'vertex' | 'azure' | 'openai' | 'gemini'
```

### 7.2 核心API客户端 (`src/services/api/claude.ts`)

- 构建请求参数 (system prompt, messages, tools, betas)
- 调用Anthropic SDK流式端点
- 处理 `BetaRawMessageStreamEvent` 事件
- 支持Prompt缓存、思维模式、自适应思考

### 7.3 OpenAI兼容层 (`src/services/api/openai/`)

将Anthropic格式转换为OpenAI格式，支持 Ollama、DeepSeek、vLLM 等。
启用方式: `CLAUDE_CODE_USE_OPENAI=1`

### 7.4 Gemini兼容层 (`src/services/api/gemini/`)

独立的环境变量体系，不与OpenAI或Anthropic配置混杂。
启用方式: `CLAUDE_CODE_USE_GEMINI=1`

---

## 八、功能标志系统 (Feature Flags)

### 8.1 Feature Gate实现

```typescript
// 导入方式（不要自己定义！）
import { feature } from 'bun:bundle'

// 使用
if (feature('CHICAGO_MCP')) {
  // 启用计算机操控功能
}
```

### 8.2 启用方式

**环境变量**: `FEATURE_<NAME>=1`

**Dev模式默认** (`scripts/dev.ts`):
```
BUDDY, TRANSCRIPT_CLASSIFIER, BRIDGE_MODE,
AGENT_TRIGGERS_REMOTE, CHICAGO_MCP, VOICE_MODE
```

**Build模式默认** (`build.ts`):
```
AGENT_TRIGGERS_REMOTE, CHICAGO_MCP, VOICE_MODE
```

### 8.3 常见Feature Flags

| Flag | 功能 |
|------|------|
| `BUDDY` | 助手模式 |
| `DAEMON` | Daemon守护进程 |
| `BRIDGE_MODE` | 远程控制 |
| `VOICE_MODE` | 语音输入 |
| `CHICAGO_MCP` | 计算机操控 (屏幕/键鼠) |
| `TRANSCRIPT_CLASSIFIER` | 自动模式安全分类器 |
| `COORDINATOR_MODE` | 协调器模式 |
| `KAIROS` | 助手服务 |
| `UDS_INBOX` | 对等发现 |
| `WORKFLOW_SCRIPTS` | 工作流脚本 |

---

## 九、权限系统

### 9.1 权限模式

```typescript
type PermissionMode =
  | 'default'           // 询问
  | 'bypassPermissions' // 绕过
  | 'acceptEdits'       // 自动接受编辑
  | 'plan'              // 仅计划模式
  | 'dontAsk'           // 不询问
  | 'auto'              // 自动模式 (TRANSCRIPT_CLASSIFIER)
```

### 9.2 权限规则

```typescript
type PermissionRule = {
  source: PermissionRuleSource  // userSettings, projectSettings, policySettings...
  ruleBehavior: PermissionBehavior  // 'allow' | 'deny' | 'ask'
  ruleValue: {
    toolName: string
    ruleContent?: string  // glob模式如 "git *"
  }
}
```

### 9.3 权限检查流程

```
checkToolPermission(tool, input, context)
  → 1. 检查绕过模式
  → 2. 检查权限规则匹配
  → 3. 运行分类器 (TRANSCRIPT_CLASSIFIER)
  → 4. 返回结果
```

---

## 十、MCP系统

### 10.1 MCP客户端架构

```typescript
// 支持的传输类型
type Transport = 'stdio' | 'sse' | 'http' | 'ws' | 'sdk'

// MCP服务器配置
type McpServerConfig = {
  type: Transport
  command?: string  // stdio
  args?: string[]
  url?: string      // sse/http/ws
  headers?: Record<string, string>
  oauth?: OAuthConfig
}
```

### 10.2 MCP工具桥接

MCP工具被包装为本地工具：

```typescript
class MCPTool {
  name = 'mcp__serverName__toolName'
  async call(args, context) {
    const result = await mcpClient.callTool(toolName, args)
    return { data: result }
  }
}
```

---

## 十一、上下文管理

### 11.1 系统上下文构建 (`src/context.ts`)

```typescript
export const getSystemContext = memoize(async () => ({
  gitStatus: await getGitStatus(),
  // ...
}))

export const getUserContext = memoize(async () => ({
  claudemdFiles: await getClaudeMds(),
  memoryFiles: await getMemoryFiles(),
}))
```

### 11.2 上下文压缩

当对话长度接近上下文窗口限制时，自动压缩历史：
- 使用模型生成摘要
- 保留最近的关键交互
- 减少发送的token数量

---

## 十二、Ink终端UI框架

### 12.1 三层架构

```
packages/@ant/ink/
├── core/        — 渲染引擎 (reconciler, layout, terminal I/O, screen buffer)
├── components/  — UI原语 (Box, Text, ScrollBox, App, hooks)
└── theme/       — 主题系统
```

### 12.2 核心API

```typescript
// 渲染入口
export { wrappedRender, renderSync, createRoot } from './core/root.js'

// 组件
export { Box, Text, ScrollBox, App } from './components/'

// 主题
export { ThemeProvider, ThemedBox, ThemedText } from './theme/'

// Hooks
export { useInput, useTerminalSize, useSearchHighlight } from './hooks/'
```

### 12.3 React集成

Ink 使用自定义React reconciler将React组件树渲染到终端：

```typescript
import { render } from '@anthropic/ink'
import { Box, Text } from '@anthropic/ink'

render(<Box>Hello Terminal</Box>)
```

---

## 十三、远程控制/Bridge模式

### 13.1 架构

```
本地CLI <---> Bridge Server <---> Claude.ai Web
         JWT认证
         WebSocket消息
```

### 13.2 关键文件

| 文件 | 职责 |
|------|------|
| `src/bridge/bridgeMain.ts` | Bridge入口和主循环 |
| `src/bridge/replBridge.ts` | REPL状态同步 |
| `src/bridge/bridgeMessaging.ts` | 消息编解码 |
| `src/bridge/jwtUtils.ts` | JWT认证 |

---

## 十四、Daemon模式

### 14.1 架构

```
Daemon进程
  ├── workerRegistry.ts  — 工作进程管理
  └── worker/*           — 各类工作进程
```

启动: `claude --daemon-worker=<kind>`

---

## 十五、构建系统

### 15.1 构建流程

```bash
# Dev模式 (scripts/dev.ts)
bun -d MACRO.VERSION:... --feature BUDDY ... cli.tsx

# 生产构建 (build.ts)
Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  splitting: true,
  define: getMacroDefines(),
  features: DEFAULT_BUILD_FEATURES
})
```

### 15.2 产物

- `dist/cli.js` + ~450 chunk文件（代码分割）
- 构建后自动处理 `import.meta.require` 兼容Node.js

---

## 十六、测试系统

- **框架**: `bun:test`
- **位置**: `src/**/__tests__/*.test.ts`
- **集成测试**: `tests/integration/`
- **Mock模式**: `mock.module()` + `await import()`

当前状态: ~1623 tests / 114 files / 0 fail

---

## 十七、关键设计模式

### 17.1 Feature Gate模式

```typescript
// ✅ 正向模式 (启用消除)
return feature('FLAG') ? featureEnabledResult : defaultResult

// ❌ 避免负向模式 (不能启用消除)
if (!feature('FLAG')) return
```

### 17.2 状态不可变性

```typescript
// 使用展开运算符创建新状态
setState(prev => ({
  ...prev,
  messages: [...prev.messages, newMessage]
}))

// Object.is 检查避免无意义更新
if (Object.is(next, prev)) return
```

### 17.3 异步生成器模式

```typescript
// 用于流式处理和管道
async function* processStream(events: Stream) {
  for await (const event of events) {
    yield transform(event)
  }
}
```

---

## 十八、依赖关系图（简化）

```
cli.tsx (入口)
  └── main.tsx (CLI定义)
      ├── REPL.tsx (UI)
      │   ├── AppState.tsx (状态)
      │   └── components/ (170+组件)
      ├── query.ts (核心逻辑)
      │   ├── tools.ts (工具注册)
      │   │   └── tools/* (60+工具)
      │   └── services/api/claude.ts (API)
      │       ├── Anthropic SDK
      │       ├── OpenAI 兼容层
      │       └── Gemini 兼容层
      ├── state/ (状态管理)
      └── services/
          ├── mcp/ (MCP客户端)
          ├── compact/ (上下文压缩)
          └── analytics/ (遥测)
```

---

## 十九、扩展指南

### 19.1 添加新工具

1. 在 `src/tools/` 创建新目录
2. 实现 `Tool` 接口
3. 在 `src/tools.ts` 中注册
4. 添加feature flag（可选）

### 19.2 添加新命令

1. 在 `src/commands/` 创建模块
2. 在 `src/commands.ts` 导入注册
3. 在 `src/main.tsx` 添加Commander子命令

### 19.3 添加Feature Flag

1. 选择启用方式: 环境变量 / dev默认 / build默认
2. 使用 `import { feature } from 'bun:bundle'` + `feature('NAME')` 包裹代码
3. **不要**在 `cli.tsx` 或其他文件里自己定义 `feature` 函数

---

## 二十、关于此代码库

- **性质**: 这是 Anthropic Claude Code CLI 的**反编译/逆向工程**版本
- **TypeScript 错误**: ~1341 个（大多数为 `unknown`/`never`/`{}` 类型），不影响 Bun 运行时执行
- **React Compiler**: 组件有反编译的 memoization boilerplate (`_c()` 调用)，属于正常现象
- **平台特定**: `computer-use-*` 后端 macOS/Windows 可用，Linux 待完成
