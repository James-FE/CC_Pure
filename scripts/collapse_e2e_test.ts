/**
 * collapse 测试 + 调试 queryHaiku 模型选择
 */
import {
  applyCollapsesIfNeeded,
} from '../src/services/contextCollapse/scheduler.js'
import {
  initContextCollapse,
  resetContextCollapse,
} from '../src/services/contextCollapse/index.js'
import {
  getCommittedLog,
  getHealth,
} from '../src/services/contextCollapse/store.js'
import { tokenCountWithEstimation } from '../src/utils/tokens.js'
import { getEffectiveContextWindowSize } from '../src/services/compact/autoCompact.js'
import { getSmallFastModel } from '../src/utils/model/model.js'
import { getAPIProvider } from '../src/utils/model/providers.js'
import { enableConfigs } from '../src/utils/config.js'

enableConfigs() // 解锁 config 读取——绕过 bootstrap 锁

const MODEL = 'qwen3.6-35b-a3b-fp8'
initContextCollapse()

// 调试：看当前模型配置
console.log(`🔍 provider: ${getAPIProvider()}`)
console.log(`🔍 smallFastModel: ${getSmallFastModel()}`)
console.log(`🔍 OPENAI_BASE_URL: ${process.env.OPENAI_BASE_URL || 'unset'}`)
console.log(`🔍 OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set(***)' : 'unset'}`)
console.log(`🔍 OPENAI_DEFAULT_HAIKU_MODEL: ${process.env.OPENAI_DEFAULT_HAIKU_MODEL || 'unset'}`)
console.log(`🔍 ANTHROPIC_SMALL_FAST_MODEL: ${process.env.ANTHROPIC_SMALL_FAST_MODEL || 'unset'}`)

const effective = getEffectiveContextWindowSize(MODEL)
const threshold = Math.floor(effective * 0.9)
console.log(`📐 有效窗口: ${effective} | 90%: ${threshold}`)

const messages: any[] = []
const PAD = '填充文本用于增加token数量测试上下文折叠。'.repeat(5)

for (let i = 0; i < 500; i++) {
  messages.push({
    uuid: `u-${i}`, type: 'user',
    message: { role: 'user', content: `[Q${i}] ${PAD} 问题${i}` },
    timestamp: new Date(Date.now() - (500-i)*60000).toISOString(),
  })
  messages.push({
    uuid: `a-${i}`, type: 'assistant',
    message: { role: 'assistant', content: `[A${i}] ${PAD} 回答${i}。` },
    timestamp: new Date(Date.now() - (500-i)*60000+30000).toISOString(),
  })
}
messages.push({
  uuid: 'final', type: 'user',
  message: { role: 'user', content: '总结我们讨论的所有问题。' },
  timestamp: new Date().toISOString(),
})

const total = tokenCountWithEstimation(messages)
console.log(`📊 ${messages.length}条 | ${total} tokens | 候选=${total-25000} | 超90%: ${total>threshold?'✅':'❌'}`)

console.log(`🚀 调用 applyCollapsesIfNeeded (这会调 queryHaiku)...`)
const ac = new AbortController()
try {
  const r = await applyCollapsesIfNeeded(messages, {
    options: { mainLoopModel: MODEL },
    abortController: { signal: ac.signal },
  })
  console.log(`📊 committed=${r.committed} | ${messages.length}→${r.messages.length}`)
} catch(e) {
  console.log(`❌ applyCollapsesIfNeeded 抛出: ${e}`)
}

const h = getHealth()
console.log(`🏥 spawns=${h.totalSpawns} errors=${h.totalErrors} empty=${h.totalEmptySpawns} err=${h.lastError||'none'}`)

for (const c of getCommittedLog()) {
  console.log(`✅ [${c.entry.strategy}] id=${c.entry.collapseId}`)
  console.log(`   摘要: "${c.entry.summary}"`)
  console.log(`   tokensIn=${c.entry.tokensIn} tokensOut=${c.entry.tokensOut}`)
}

resetContextCollapse()
