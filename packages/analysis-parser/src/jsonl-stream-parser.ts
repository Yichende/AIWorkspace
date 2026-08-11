import type {
  JsonlParsedEvent,
  ChartConfig,
  TableConfig,
  JsonlStreamParserOptions,
} from './types'

// ═══════════════════════════════════════════════════════════════
// JSONL Stream Parser — BraceCounter 状态机
// ═══════════════════════════════════════════════════════════════

export class JsonlStreamParser {
  private buffer = ''
  private braceCount = 0
  private inString = false
  private escapeNext = false
  private jsonStart = -1
  private readonly onDebug?: (msg: string) => void

  constructor(opts?: JsonlStreamParserOptions) {
    this.onDebug = opts?.onDebug
  }

  /** 喂入新 chunk，返回解析出的完整 JsonlParsedEvent[] */
  feed(chunk: string): JsonlParsedEvent[] {
    const events: JsonlParsedEvent[] = []
    this.buffer += chunk

    // character scanner
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i]

      // 处理转义
      if (this.escapeNext) {
        this.escapeNext = false
        continue
      }
      if (ch === '\\') {
        this.escapeNext = true
        continue
      }

      // 字符串边界
      if (ch === '"') {
        this.inString = !this.inString
        continue
      }

      // 字符串内部 → 跳过 {} 计数
      if (this.inString) continue

      // 追踪大括号
      if (ch === '{') {
        if (this.braceCount === 0) this.jsonStart = i
        this.braceCount++
      } else if (ch === '}') {
        this.braceCount--
        if (this.braceCount === 0 && this.jsonStart >= 0) {
          // 完整 JSON 对象
          const jsonStr = this.buffer.slice(this.jsonStart, i + 1)
          const event = parseEvent(jsonStr, this.onDebug)
          if (event) events.push(event)
          // 从 buffer 移除已处理部分
          this.buffer = this.buffer.slice(i + 1)
          i = -1 // 重置循环
          this.jsonStart = -1
        }
      }
    }

    return events
  }

  /** Flush 剩余 buffer，尝试提取最后的不完整 JSON */
  flush(): JsonlParsedEvent[] {
    const events: JsonlParsedEvent[] = []
    // 尝试用 tryFixJson 挽救最后一个可能完整但格式有问题的 JSON
    if (this.buffer.trim()) {
      const event = parseEvent(this.buffer.trim(), this.onDebug)
      if (event) events.push(event)
      this.buffer = ''
    }
    return events
  }

  reset(): void {
    this.buffer = ''
    this.braceCount = 0
    this.inString = false
    this.escapeNext = false
    this.jsonStart = -1
  }
}

// ── Private helpers ────────────────────────────────────────────

function parseEvent(
  jsonStr: string,
  onDebug?: (msg: string) => void,
): JsonlParsedEvent | null {
  // Step 1: 直接 parse
  try {
    const obj = JSON.parse(jsonStr)
    return validateEvent(obj)
  } catch {
    // fall through to repair
  }

  // Step 2: 尝试修复
  const fixed = tryFixJson(jsonStr)
  if (!fixed) {
    onDebug?.(`JSONL parse failed (unfixable): ${jsonStr.slice(0, 200)}`)
    return null
  }

  try {
    const obj = JSON.parse(fixed)
    return validateEvent(obj)
  } catch {
    onDebug?.(`JSONL parse failed (after fix): ${fixed.slice(0, 200)}`)
    return null
  }
}

function validateEvent(obj: Record<string, any>): JsonlParsedEvent | null {
  switch (obj.type) {
    case 'text': {
      // 兼容 "delta" 和 "content" 两种命名
      const d = obj.content ?? obj.delta
      return typeof d === 'string'
        ? { type: 'text', content: d }
        : null
    }

    case 'chart': {
      const c = obj.chart
      return c?.type && c?.title && c?.data
        ? { type: 'chart', payload: c as ChartConfig }
        : null
    }

    case 'table': {
      const t = obj.table
      return t?.title && t?.columns && t?.data
        ? { type: 'table', payload: t as TableConfig }
        : null
    }

    default:
      return null // 未知 type，安全丢弃
  }
}

// ═══════════════════════════════════════════════════════════════
// Minimal JSON Repair（最小修复链）
// ═══════════════════════════════════════════════════════════════

export function tryFixJson(raw: string): string | null {
  let fixed = raw.trim()

  // Step 1: 去除 markdown 代码块包裹
  const m = fixed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/m)
  if (m) fixed = m[1].trim()

  // Step 2: 提取 { 到 } 之间的内容（丢弃前后垃圾文本）
  const a = fixed.indexOf('{')
  const b = fixed.lastIndexOf('}')
  if (a !== -1 && b > a) fixed = fixed.slice(a, b + 1)

  // Step 3: 移除尾随逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1')

  // Step 4: 引用未加引号的 key
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3')

  if (fixed !== raw.trim()) return fixed
  return null
}
