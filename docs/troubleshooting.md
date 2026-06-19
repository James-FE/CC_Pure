# CCP 调试手册：高频复现问题

Phase merge（从 CCB/main cherry-pick 到 test 分支）后最常见的几类 bug，及排查方法。

> **原则**：Phase N 的 cherry-pick 会覆盖 Phase N-1 的修复。每次 merge 后必须跑验证清单。

---

## 1. `feature is not defined`

**症状**：
```
ReferenceError: feature is not defined
at <anonymous> (.../dist-nosplit/cli.js:100511:15)
```

**根因**：某个源文件调用了 `feature('FLAG_NAME')` 但没有 `import { feature } from 'bun:bundle'`。
Phase cherry-pick 时，CCB/main 上的 commit 可能：
- 删掉了 import（因为 CCB/main 用不到，上游已移除 feature 调用）
- 新增了 feature 调用但没加 import

**排查**：
```bash
cd ~/workspace/CC_Pure
for f in $(grep -rl "feature(" src/ | grep -v node_modules | grep -v '.bak'); do
  if ! grep -q "import.*feature.*from.*bun:bundle" "$f"; then
    echo "MISSING feature import: $f"
  fi
done
```

**修复**：手动加回 `import { feature } from 'bun:bundle'`。

**历史案例**：
- Phase 2：`a648196c` 给 `permissions.ts` 加了 feature import（19 个 Cannot find name 修复之一）
- Phase 3：cherry-pick 删掉了这行 import → `feature is not defined`

---

## 2. CCP 读到 Claude 的配置

**症状**：CCP UI 显示的模型和 settings.json 里写的不一样，或连接错误的端口。

**示例**：
```json
// ~/.claude/settings.local.json（不是 CCP 的！）
{"env": {"OPENAI_BASE_URL": "http://127.0.0.1:8083/v1"}}
```
→ CCP 在 home 目录启动时，把这个当成项目级 `localSettings` 加载。

**根因**：`getRelativeSettingsFilePathForSource('localSettings')` 返回 `.claude/settings.local.json`（相对于 CWD）。
当 CCP 在 `/home/spark` 启动时，路径 = `/home/spark/.claude/settings.local.json` = `~/.claude/settings.local.json`。

**修复**：`src/utils/settings/settings.ts` 中改为 `.ccp/settings.local.json`（commit 已包含）。

**排查**：
```bash
# 看 CCP 实际请求的 URL（从 session log）
grep '"path"' ~/.ccp/projects/-home-spark/*.jsonl | tail -3

# 检查是否读到了 Claude 的 settings
cat ~/.claude/settings.local.json  # 应该为空 {}
```

**CCP 的 settings 层级**（修复后）：
1. 用户级：`~/.ccp/settings.json`（launcher 设了 `CLAUDE_CONFIG_DIR=~/.ccp`）
2. 项目级：`<project>/.ccp/settings.json`
3. 项目本地：`<project>/.ccp/settings.local.json`

---

## 3. Phase Merge 后 `ccp` 直接 Crash

**启动验证清单**（每次 merge 后必须跑）：
```bash
# 1. Build
cd ~/workspace/CC_Pure && bun run build

# 2. Smoke
ccp --version                     # 必须打印版本号
echo "say ok" | timeout 60 ccp -p # 必须返回 AI 回复

# 3. Import 回归检查
for f in $(grep -rl "feature(" src/ | grep -v node_modules | grep -v '.bak'); do
  if ! grep -q "import.*feature.*from.*bun:bundle" "$f"; then
    echo "MISSING feature import: $f"
  fi
done

# 4. Typecheck
bun run check
```

**如 test 分支已有 Phase N-1 的修复，merge 前先 diff**：
```bash
git diff <phase_n_minus_1_cutoff>..HEAD -- src/types/ src/bootstrap/
```
看有没有被删除的行是之前有意加的修复。

---

## 4. API Connection Error（非代码 bug）

**症状**：
```
API Error: Connection error.
```

**常见原因**：
1. 模型服务没启动（`docker ps | grep qwen` / `curl http://127.0.0.1:8000/health`）
2. settings 指向了错误的端口
3. settings 被 Claude 的文件覆盖（见第 2 节）

**排查**：
```bash
# 确认模型服务状态
curl http://127.0.0.1:8000/health

# 查看 CCP 实际请求的 URL
grep '"path"' ~/.ccp/projects/-home-spark/*.jsonl | tail -1
```

---

## 5. 构建产物没有 sourcemap

`build.ts` 默认不生成 sourcemap。要启用，在 `Bun.build()` 中添加：
```typescript
sourcemap: 'external',  // 或 'inline'
```

---

## 关键文件索引

| 文件 | 作用 |
|------|------|
| `src/utils/envUtils.ts` | `getClaudeConfigHomeDir()` — 用户配置目录 |
| `src/utils/settings/settings.ts` | settings 加载逻辑、文件路径 |
| `src/types/permissions.ts` | feature flag 调用点（高频出问题） |
| `scripts/defines.ts` | `DEFAULT_BUILD_FEATURES`、`getMacroDefines()` |
| `build.ts` | 构建入口 |
| `~/.local/bin/ccp` | launcher 脚本（设置 `CLAUDE_CONFIG_DIR` 等环境变量） |
