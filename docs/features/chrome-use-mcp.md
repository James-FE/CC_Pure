# Chrome Use — 浏览器自动化快速指南

让 Claude Code 直接控制你的 Chrome 浏览器，用自然语言完成网页操作。

## 快速开始（3 分钟）

### 第一步：安装 Chrome 扩展

1. 下载扩展：https://github.com/hangwin/mcp-chrome/releases
2. 解压 zip 文件
3. 打开 Chrome 访问 `chrome://extensions/`
4. 开启右上角「开发者模式」
5. 点击「加载已解压的扩展程序」，选择解压后的文件夹

### 第二步：启动 CCP

```bash
bun run dev
ccp # 或者 ccp 安装版也行
```

### 第三步：启用 Chrome MCP

1. 在 REPL 中输入 `/mcp` 打开 MCP 面板
2. 找到 `mcp-chrome`，按空格键启用
3. 按 Enter 确认

## 在 Linux 服务器上使用

如果你的服务器没有图形界面，可以通过以下方式使用 Chrome MCP：

1. 在本地有 Chrome 的机器上安装扩展
2. 通过网络将 Chrome DevTools 端口暴露给服务器
3. 或者使用 `CLAUDE_CODE_SKIP_CHROME_MCP_SETUP=1` 跳过自动设置（之后手动执行 `node scripts/setup-chrome-mcp.mjs`）

## 相关文档

- GitHub 仓库：https://github.com/hangwin/mcp-chrome
