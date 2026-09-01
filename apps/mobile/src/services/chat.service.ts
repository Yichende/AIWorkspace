import type { ChatMessage } from '@repo/types'
import { generateId } from '@/stores/chat.store'

// ── Reply templates ──────────────────────────────────────────

interface TemplateRule {
  keywords: string[]
  reply: string
}

const TEMPLATES: TemplateRule[] = [
  {
    keywords: ['你好', '嗨', 'hi', 'hello', 'hey'],
    reply: '你好！有什么我可以帮助你的吗？',
  },
  {
    keywords: ['谢谢', '感谢', '多谢', 'thanks', 'thank'],
    reply: '不客气！随时为你效劳。',
  },
  {
    keywords: ['再见', '拜拜', 'bye', '再见啦'],
    reply: '再见！期待下次交流。',
  },
  {
    keywords: ['名字', '你是谁', '叫什么', 'who are you'],
    reply: '我是知数 AI，你的智能助手。我可以回答问题、分析数据、生成图表，帮助你完成各种任务。',
  },
  {
    keywords: ['功能', '能做什么', '帮助', 'help', '能力'],
    reply: '我可以帮你：\n1. 回答各类问题\n2. 分析数据并生成图表\n3. 编写和解释代码\n4. 进行文本处理和翻译\n5. 提供技术方案建议\n\n有什么想试试的吗？',
  },
  {
    keywords: ['天气', 'weather'],
    reply: '暂不支持实时天气查询，但未来我会接入天气服务，敬请期待！',
  },
  {
    keywords: ['React', 'react', 'hooks', '组件'],
    reply: 'React 是一个构建用户界面的 JavaScript 库。关于 React 的问题我可以帮你：\n- 组件设计和生命周期\n- Hooks 的使用（useState, useEffect, useMemo 等）\n- 状态管理方案\n- 性能优化\n\n你想了解哪方面的内容？',
  },
  {
    keywords: ['TypeScript', 'typescript', 'ts', '类型'],
    reply: 'TypeScript 为 JavaScript 添加了静态类型检查，能大幅提升代码质量和开发体验。核心概念包括：\n- 基础类型与接口\n- 泛型\n- 联合类型与交叉类型\n- 类型推导与类型守卫\n\n需要我详细讲解哪个部分？',
  },
  {
    keywords: ['Taro', 'taro', '小程序', 'weapp'],
    reply: 'Taro 是一个开放式跨端跨框架解决方案，支持使用 React/Vue/Nerv 等框架开发微信/支付宝/字节等小程序和 H5 应用。常用特性：\n- 统一的 API 和组件\n- 条件编译处理平台差异\n- NutUI 组件库\n- 多端适配方案\n\n你在开发中遇到了什么问题？',
  },
]

const FALLBACK_REPLIES: string[] = [
  '这是一个很好的问题。让我想想……\n\n基于目前的信息，我建议从以下几个方面来考虑：\n1. 明确需求和目标\n2. 分析可行的方案\n3. 选择最适合的路径\n\n需要我进一步展开吗？',
  '我理解你的意思了。这个问题涉及多个方面，我来分析一下：\n\n首先，需要明确核心目标。其次，要考虑资源和时间约束。最后，选择可行的实施方案。\n\n有什么具体的细节你想深入了解的？',
  '有意思的问题！让我从技术角度分析：\n\n这个问题的关键在于平衡性能和可维护性。建议采用渐进式方案，先实现核心功能，然后逐步优化。\n\n你觉得这个方向如何？',
]

// ── Helpers ──────────────────────────────────────────────────

const CHUNK_SIZE_MIN = 1
const CHUNK_SIZE_MAX = 3
const DELAY_MIN = 30
const DELAY_MAX = 80

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Split text into random-sized small chunks to simulate token streaming */
function* chunkText(text: string): Generator<string> {
  let i = 0
  while (i < text.length) {
    const size = Math.floor(Math.random() * (CHUNK_SIZE_MAX - CHUNK_SIZE_MIN + 1)) + CHUNK_SIZE_MIN
    yield text.slice(i, i + size)
    i += size
  }
}

function matchReply(userMessage: string): string {
  const lower = userMessage.toLowerCase()
  for (const rule of TEMPLATES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.reply
    }
  }
  const idx = Math.floor(Math.random() * FALLBACK_REPLIES.length)
  return FALLBACK_REPLIES[idx]
}

// ── Public API ───────────────────────────────────────────────

/**
 * Simulate streaming AI reply.
 *
 * Emits characters in small chunks via `onDelta`, then calls `onDone`
 * with the complete ChatMessage when finished.
 *
 * Designed as a drop-in replacement target for real API/WebSocket calls —
 * swap the implementation while keeping the same callback signature.
 */
export async function simulateAIReplyStream(
  userMessage: string,
  onDelta: (delta: string) => void,
  onDone: (finalMessage: ChatMessage) => void,
): Promise<void> {
  const replyText = matchReply(userMessage)
  const messageId = generateId()

  for (const chunk of chunkText(replyText)) {
    await delay(Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN)
    onDelta(chunk)
  }

  const finalMessage: ChatMessage = {
    id: messageId,
    role: 'assistant',
    blocks: [
      {
        type: 'text',
        content: replyText,
      },
    ],
    status: 'success',
    createdAt: Date.now(),
  }

  onDone(finalMessage)
}

/**
 * Stream AI reply.
 *
 * Drop-in replacement for `simulateAIReplyStream` — wraps the mock
 * with the same callback signature. When real AI backend is ready,
 * swap the implementation here (SSE / WebSocket / fetch stream).
 */
export async function streamAIReply(
  userMessage: string,
  onDelta: (delta: string) => void,
  onDone: (finalMessage: ChatMessage) => void,
): Promise<void> {
  // TODO: Replace with real AI API call when backend is ready
  return simulateAIReplyStream(userMessage, onDelta, onDone)
}
