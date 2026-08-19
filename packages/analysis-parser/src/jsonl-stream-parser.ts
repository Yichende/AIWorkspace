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
  /** 上次扫描停止的偏移：跨 chunk 增量扫描，避免整段重扫导致状态错位 */
  private scanOffset = 0
  private readonly onDebug?: (msg: string) => void

  constructor(opts?: JsonlStreamParserOptions) {
    this.onDebug = opts?.onDebug
  }

  /** 喂入新 chunk，返回解析出的完整 JsonlParsedEvent[] */
  feed(chunk: string): JsonlParsedEvent[] {
    const events: JsonlParsedEvent[] = []
    this.buffer += chunk

    // 增量扫描：从上次中断的位置继续。
    // 不能每次从 0 重扫——inString/escapeNext 记录的是 buffer 末尾的状态，
    // 重扫开头会引号配对错位，导致跨 chunk 的 JSON 事件永远解析不出来。
    for (let i = this.scanOffset; i < this.buffer.length; i++) {
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
          if (event) {
            events.push(event)
            // 从 buffer 移除已处理部分
            this.buffer = this.buffer.slice(i + 1)
          } else {
            // 解析失败（如字符串内出现未转义引号导致花括号计数失同步）：
            // 只跳过开头的 { 并重置状态，继续扫描以恢复后续合法事件，
            // 避免把整个损坏区间连同后面的事件一起吞掉。
            this.buffer = this.buffer.slice(this.jsonStart + 1)
            this.inString = false
            this.escapeNext = false
          }
          // 缓冲区被截断，扫描位置与状态全部重置到新 buffer 开头
          this.scanOffset = 0
          i = -1 // 重置循环
          this.jsonStart = -1
        }
      }
    }

    this.scanOffset = this.buffer.length
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
    this.scanOffset = 0
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
    return validateEvent(obj, onDebug)
  } catch (err: any) {
    // Step 2: 尝试修复
    const fixed = tryFixJson(jsonStr)
    if (!fixed) {
      onDebug?.(
        `JSONL parse failed (unfixable): ${err?.message || err} | text: ${jsonStr.slice(0, 300)}`,
      )
      return null
    }

    try {
      const obj = JSON.parse(fixed)
      return validateEvent(obj, onDebug)
    } catch (err2: any) {
      onDebug?.(
        `JSONL parse failed (after fix): ${err2?.message || err2} | text: ${fixed.slice(0, 300)}`,
      )
      return null
    }
  }
}

function validateEvent(
  obj: Record<string, any>,
  onDebug?: (msg: string) => void,
): JsonlParsedEvent | null {
  // 兼容 "event" 和 "type" 两种顶层字段名
  const eventType = obj.event ?? obj.type;

  switch (eventType) {
    case 'text': {
      const d = obj.content ?? obj.delta
      if (typeof d !== 'string') {
        onDebug?.(`[validate] text: delta/content 不是 string (type=${typeof d})`)
        return null
      }
      return { type: 'text', content: d }
    }

    case 'summary': {
      const d = obj.content ?? obj.delta
      if (typeof d !== 'string') {
        onDebug?.(`[validate] summary: delta/content 不是 string (type=${typeof d})`)
        return null
      }
      return { type: 'summary', content: d }
    }

    case 'insights': {
      const items = obj.items ?? obj.insights
      if (!Array.isArray(items) || items.some((i) => typeof i !== 'string')) {
        onDebug?.(`[validate] insights: items 不是 string[] (type=${typeof items})`)
        return null
      }
      return { type: 'insights', items }
    }

    case 'report': {
      const d = obj.content ?? obj.delta
      if (typeof d !== 'string') {
        onDebug?.(`[validate] report: delta/content 不是 string (type=${typeof d})`)
        return null
      }
      return { type: 'report', content: d }
    }

    case 'chart': {
      const c = obj.chart
      if (!c) {
        onDebug?.(`[validate] chart: 缺少 chart 字段，obj keys=${Object.keys(obj).join(',')}`)
        return null
      }
      if (!c.type) {
        onDebug?.(`[validate] chart: 缺少 chart.type，keys=${Object.keys(c).join(',')}`)
        return null
      }
      if (!c.title) {
        onDebug?.(`[validate] chart: 缺少 chart.title，keys=${Object.keys(c).join(',')}`)
        return null
      }
      if (!c.data) {
        onDebug?.(`[validate] chart: 缺少 chart.data，keys=${Object.keys(c).join(',')}`)
        return null
      }
      return { type: 'chart', payload: c as ChartConfig }
    }

    case 'table': {
      const t = obj.table
      if (!t) {
        onDebug?.(`[validate] table: 缺少 table 字段，obj keys=${Object.keys(obj).join(',')}`)
        return null
      }
      if (!t.title) {
        onDebug?.(`[validate] table: 缺少 table.title，keys=${Object.keys(t).join(',')}`)
        return null
      }
      if (!t.columns) {
        onDebug?.(`[validate] table: 缺少 table.columns，keys=${Object.keys(t).join(',')}`)
        return null
      }
      if (!t.data) {
        onDebug?.(`[validate] table: 缺少 table.data，keys=${Object.keys(t).join(',')}`)
        return null
      }
      return { type: 'table', payload: t as TableConfig }
    }

    default:
      onDebug?.(
        `[validate] 未知 event 类型: "${eventType}"，obj keys=${Object.keys(obj).join(',')}`,
      )
      return null
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

  // Step 3: 转义 JSON 字符串内的真实换行符
  fixed = escapeNewlinesInStrings(fixed)

  // Step 4: 移除尾随逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1')

  // Step 5: 引用未加引号的 key
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3')

  if (fixed !== raw.trim()) return fixed
  return null
}

/**
 * 转义 JSON 字符串值内部的真实换行符。
 * 逐字符扫描，追踪引号边界，将字符串内的 \n / \r 替换为转义形式。
 * 已经在转义状态的 \n（即前有 \ 的 n）不重复转义。
 */
function escapeNewlinesInStrings(json: string): string {
  const out: string[] = []
  let inString = false
  let escapeNext = false

  for (let i = 0; i < json.length; i++) {
    const ch = json[i]

    if (escapeNext) {
      out.push(ch)
      escapeNext = false
      continue
    }

    if (ch === '\\') {
      out.push(ch)
      escapeNext = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      out.push(ch)
      continue
    }

    if (inString) {
      if (ch === '\n') {
        out.push('\\n')
      } else if (ch === '\r') {
        out.push('\\r')
      } else {
        out.push(ch)
      }
    } else {
      out.push(ch)
    }
  }

  return out.join('')
}
