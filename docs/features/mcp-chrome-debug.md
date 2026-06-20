# mcp-chrome 调试文档

> CCP 社区版 Chrome MCP 桥接功能——让 CCP 通过 Chrome 扩展控制浏览器。

## 1. 功能定位

`mcp-chrome` 是 CCP 社区在 `main.tsx:1821` 硬编码的 Built-in MCP server，让 CCP 能操控本地 Chrome/Chromium 浏览器（导航、点击、填表、截图、读 DOM 等）。

与 Anthropic 官方 `claude-in-chrome` 的区别：

| | mcp-chrome (CCP 社区) | claude-in-chrome (Anthropic 官方) |
|---|---|---|
| MCP 传输 | HTTP (`127.0.0.1:12306`) | stdio |
| Chrome 扩展 | hangwin/mcp-chrome (社区) | Anthropic 官方扩展 |
| 认证 | 静态 token (`my-static-token`) | OAuth PKCE |
| Gate | 始终编译 | `USER_TYPE=ant` 或付费订阅 |
| 成熟度 | 社区维护，有已知 bug | 官方维护 |

## 2. 架构

```
┌──────────┐  native messaging   ┌─────────────────┐  HTTP MCP   ┌─────────┐
│ Chromium │ ◄──────────────────► │ mcp-chrome-bridge │ ◄─────────► │   CCP   │
│ 扩展     │    (stdin/stdout)    │ (127.0.0.1:12306) │             │ main.tsx│
└──────────┘                     └─────────────────┘             └─────────┘
```

三个组件缺一不可：

| 组件 | 路径/位置 | 责任 |
|------|----------|------|
| Chrome 扩展 | `~/snap/chromium/common/extensions/mcp-chrome/` | 在浏览器中执行操作，通过 Native Messaging 与桥通信 |
| Native Host 注册 | `~/.config/chromium/NativeMessagingHosts/com.chromemcp.nativehost.json` | 注册扩展与桥之间的通道 |
| 桥接服务 | `node_modules/@claude-code-best/mcp-chrome-bridge/dist/index.js` | 启动 HTTP MCP server 在 12306 端口 |
| CCP 配置 | `src/main.tsx:1821` | 硬编码 `mcp-chrome` MCP server，连接 12306 |

## 3. 依赖

```bash
# npm 包
@claude-code-best/mcp-chrome-bridge@^3.0.1   # 桥接服务 + native host CLI
hangwin/mcp-chrome (GitHub)                    # Chrome 扩展 (需手动下载)

# 系统
Chromium (snap)                                # 浏览器
Node.js ≥18                                    # 桥运行环境
```

## 4. 启动流程

### 4.1 首次安装

```bash
# 1. 下载扩展
curl -L -o /tmp/chrome-mcp-server.zip \
  https://github.com/hangwin/mcp-chrome/releases/download/v1.0.0/chrome-mcp-server-1.0.0.zip
unzip /tmp/chrome-mcp-server.zip -d /tmp/chrome-mcp-server/

# 2. 安装扩展到 snap Chromium 可访问的路径
mkdir -p ~/snap/chromium/common/extensions/mcp-chrome
cp -r /tmp/chrome-mcp-server/* ~/snap/chromium/common/extensions/mcp-chrome/

# 3. 注册 Native Messaging Host
cd ~/workspace/CC_Pure
node node_modules/@claude-code-best/mcp-chrome-bridge/dist/cli.js register --browser chromium

# 4. 启动 Chromium (加载扩展 + 开启 CDP)
DISPLAY=:0 snap run chromium \
  --remote-debugging-port=9222 \
  --load-extension=$HOME/snap/chromium/common/extensions/mcp-chrome \
  about:blank &

# 5. 启动桥接服务 (watchdog 自动重启)
/usr/bin/node /tmp/bridge-watchdog.mjs &
```

### 4.2 日常使用

Chromium 保持运行，桥接服务保持运行。CCP 启动时自动连接。

### 4.3 验证连通性

```bash
# 检查桥是否在监听
ss -tlnp | grep 12306

# 测试 MCP 握手
curl -s -X POST http://127.0.0.1:12306/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer my-static-token" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ccp","version":"1.0"}},"id":1}'
# 预期输出包含: "serverInfo":{"name":"ChromeMcpServer","version":"1.0.0"}

# 在 CCP 中查看
ccp
> /mcp
# mcp-chrome 应显示 ✓ enabled 而非 ✘ failed
```

## 5. 已知 Bug：ERR_HTTP_HEADERS_SENT

### 现象

桥接服务反复崩溃，日志显示：

```
Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
    at ServerResponse.setHeader (node:_http_outgoing:648:11)
    at StreamableHTTPServerTransport.handleRequest (streamableHttp.js:146:9)
```

### 根因

HTTP 响应有严格的生命周期——headers 必须先于 body 写入，且只能写一次。桥的代码在两条路径上都触发了双重写入：

**POST `/mcp` (line 1903)**：`transport.handleRequest()` 内部调用 `getRequestListener`，后者把 Node.js req/res 转为 Web Standard 处理后再写回——但 Hono 框架在此之前已经开始了响应写入。两个 writer 抢同一个 `res` 对象，第二个触发 `ERR_HTTP_HEADERS_SENT`。

**GET `/mcp` (line 1920, SSE)**：桥先调 `outgoing.flushHeaders()` 发送 SSE 事件流头，然后 `transport.handleRequest()` 再尝试写 headers。

### 修复

位于 `node_modules/@claude-code-best/mcp-chrome-bridge/dist/index.js`，在 POST 和 GET 两个 handler 中，对 `outgoing.writeHead`、`outgoing.setHeader`、`outgoing.flushHeaders` 做幂等包装：

```js
const origWriteHead = outgoing.writeHead;
const origSetHeader = outgoing.setHeader;
outgoing.writeHead = function() {
  try { return origWriteHead.apply(this, arguments); }
  catch(e) { if (e.code !== 'ERR_HTTP_HEADERS_SENT') throw e; }
};
outgoing.setHeader = function() {
  try { return origSetHeader.apply(this, arguments); }
  catch(e) { if (e.code !== 'ERR_HTTP_HEADERS_SENT') throw e; }
};
```

**为什么安全**：第一个 writer 已经把正确的 HTTP 响应发出去了，第二个 writer 的 header 写入是冗余操作。忽略这场"抢信"不影响实际通信。

> ⚠️ `npm install` 会覆盖此修复。需要重新应用，或将修复提交到社区上游。

## 6. Watchdog 脚本

桥可能因各种原因崩溃（Chrome 重启、网络波动等）。watchdog 自动重启：

```js
// /tmp/bridge-watchdog.mjs
import { spawn } from 'node:child_process';

function start() {
  const child = spawn('/usr/bin/node', ['-e', `
    process.on('uncaughtException', function(e) {
      if (e.code === 'ERR_HTTP_HEADERS_SENT') return;
      console.error('Fatal:', e.message);
      process.exit(1);
    });
    require('${BRIDGE_PATH}');
  `], { stdio: ['pipe', 'inherit', 'inherit'] });

  // Send native-messaging framed START
  const msg = JSON.stringify({ type: 'start' });
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(Buffer.byteLength(msg), 0);
  child.stdin.write(Buffer.concat([lenBuf, Buffer.from(msg)]));

  child.on('exit', () => setTimeout(start, 3000));
}
start();
```

## 7. 排障清单

| 症状 | 可能原因 | 检查 |
|------|---------|------|
| `/mcp` 显示 ✘ failed | 桥服务未启动 | `ss -tlnp \| grep 12306` |
| 桥反复崩溃 | `ERR_HTTP_HEADERS_SENT` bug | 检查修复是否被 `npm install` 覆盖；重启 watchdog |
| 桥启动但扩展无响应 | Chromium 未运行或扩展未加载 | `curl http://127.0.0.1:9222/json` 检查扩展是否在列表中 |
| Native host 未注册 | 未运行 register 命令 | `ls ~/.config/chromium/NativeMessagingHosts/` |
| Chromium 闪退 | snap 沙箱权限 | 确保扩展路径在 `~/snap/chromium/common/` 下 |
| MCP 工具列表为空 | 扩展未正确连接 native host | 查看 Chromium 扩展的 service worker 日志 (chrome://extensions → 开发者模式 → 检查视图) |

## 8. 文件索引

| 文件 | 用途 |
|------|------|
| `src/main.tsx:1821` | 硬编码 mcp-chrome MCP server 配置 |
| `node_modules/@claude-code-best/mcp-chrome-bridge/dist/index.js` | 桥接服务主体（含已知 bug + 修复点） |
| `node_modules/@claude-code-best/mcp-chrome-bridge/dist/cli.js` | Native host 注册 CLI |
| `scripts/setup-chrome-mcp.mjs` | 自动安装脚本（已废弃，手动流程更可靠） |
| `~/.config/chromium/NativeMessagingHosts/com.chromemcp.nativehost.json` | Native host 注册清单 |
| `~/snap/chromium/common/extensions/mcp-chrome/` | 扩展安装位置 |
| `/tmp/bridge-watchdog.mjs` | 桥接 watchdog + ERR_HTTP_HEADERS_SENT crash guard |
| `/tmp/start-chrome-bridge.mjs` | 一次性桥启脚本（已废弃，用 watchdog 代替） |

## 9. 未来改进

1. **提 PR 到上游**：将 `ERR_HTTP_HEADERS_SENT` 修复合并到 `@claude-code-best/mcp-chrome-bridge`
2. **systemd service**：将 watchdog 改为系统服务，开机自启
3. **移除硬编码**：将 `main.tsx:1821` 的硬编码配置改为 feature flag 或用户级 MCP 配置
4. **统一为 claude-in-chrome**：长期来看，Anthropic 官方方案更稳定，可考虑迁移
