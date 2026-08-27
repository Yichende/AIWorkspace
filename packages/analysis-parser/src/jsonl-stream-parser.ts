import type {
  JsonlParsedEvent,
  ChartConfig,
  TableConfig,
  JsonlStreamParserOptions,
} from './types'

// ═══════════════════════════════════════════════════════════════
// JSONL Stream Parser — BraceCounter 状态机
//
// 事件枚举协议：流中每个完整 JSON 对象都是一个事件信封
// {"event":"summary",...}{"event":"insights",...}... —— 逐对象提取，
// 每个事件独立解析、独立容错，单个事件损坏不影响其余事件。
// 事件字段宽容：content/delta/data 均可承载内容，chart/table 支持
// 标准信封与模型自创的 {event, data} 结构（含 ECharts 风格转换）。
// ═══════════════════════════════════════════════════════════════

/** 悬挂对象长度上限：超过即视为残缺区间，触发修复/丢弃（防御无分隔符的紧凑流） */
const MAX_HANGING = 8000

/** 事件边界检测所需的 lookahead 长度（{"event":... 前缀） */
const EVENT_BOUNDARY_LOOKAHEAD = 64

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
    /** 暂停扫描的位置（事件边界 lookahead 不足，等更多数据），-1 表示未暂停 */
    let pausedAt = -1

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
        const rest = this.buffer.slice(i, i + EVENT_BOUNDARY_LOOKAHEAD)
        // 有悬挂对象时，{ 可能是残缺事件后的新事件开头，也可能只是子对象
        // （数组元素 {"日期" 等）——lookahead 不足（chunk 末尾）时无法判定，
        // 暂停扫描等更多数据，避免把新事件 { 误当子对象计数、吞掉后续事件。
        // 无悬挂（bc=0）时 { 一定是新对象开头，直接正常处理无需 lookahead。
        if (
          this.braceCount > 0 &&
          this.jsonStart >= 0 &&
          rest.length < EVENT_BOUNDARY_LOOKAHEAD
        ) {
          pausedAt = i
          break
        }
        // 事件边界检测：行首 { 且是 event 信封，或 type 值为事件类型的信封，
        // 而前面已有悬挂对象 → 前一个对象残缺（漏闭合括号/括号错位），
        // 先尝试修复或丢弃，避免残缺对象的括号与后续事件混在一起计数、
        // 把后续事件吞掉。注意 {"type":"line" 等图表配置对象不是事件边界。
        if (
          this.braceCount > 0 &&
          this.jsonStart >= 0 &&
          (/^\s*\{\s*"event"/.test(rest) ||
            /^\s*\{\s*"type"\s*:\s*"(summary|insights|report|text|chart|table)"/.test(
              rest,
            ))
        ) {
          this.settleHanging(i, events)
          this.scanOffset = 0
          i = -1 // 重置循环
          continue
        }
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
            // 解析失败（损坏对象，如未知 event 类型/结构非法）：
            // 跳过整个损坏对象（jsonStart → i+1），其后的合法事件保留。
            // 不能只跳过开头的 {——残留的裸 }、" 等会污染后续扫描
            // （括号计数成负数、jsonStart 丢失），导致后续事件无法提取。
            this.buffer = this.buffer.slice(i + 1)
            this.inString = false
            this.escapeNext = false
          }
          // 缓冲区被截断，扫描位置与状态全部重置到新 buffer 开头
          this.scanOffset = 0
          i = -1 // 重置循环
          this.jsonStart = -1
        }
      } else if (
        ch === '\n' &&
        (this.buffer[i - 1] === '\n' ||
          (this.buffer[i - 1] === '\r' && this.buffer[i - 2] === '\n'))
      ) {
        // 空行检测：模型常用空行分隔事件（如 ```json\n{...}\n```\n\n）。
        // 空行处仍有悬挂对象 = 残缺事件 → 尝试修复或丢弃。
        if (this.braceCount > 0 && this.jsonStart >= 0) {
          this.settleHanging(i, events)
          this.scanOffset = 0
          i = -1 // 重置循环
        }
      } else if (
        this.braceCount > 0 &&
        this.jsonStart >= 0 &&
        i - this.jsonStart > MAX_HANGING
      ) {
        // 长度兜底：无空行/无事件边界的紧凑残缺区间（防御性）→ 尝试修复或丢弃
        this.settleHanging(i, events)
        this.scanOffset = 0
        i = -1 // 重置循环
      }
    }

    // 暂停等待更多数据时保留暂停位置，否则推进到 buffer 末尾
    this.scanOffset = pausedAt >= 0 ? pausedAt : this.buffer.length
    return events
  }

  /**
   * 结束悬挂区间（残缺事件处理）：提取 jsonStart → end 的文本，
   * 尝试用修复链补全为事件；成功则推送，失败则丢弃。
   * 无论成败都把 buffer 截断到 end，重置状态——否则残缺对象的括号
   * 会与后续事件混在一起计数，把后面的合法事件吞掉。
   */
  private settleHanging(end: number, events: JsonlParsedEvent[]): void {
    const hanging = this.buffer.slice(this.jsonStart, end).trimEnd()
    const event = parseEvent(hanging, this.onDebug)
    if (event) events.push(event)
    this.buffer = this.buffer.slice(end)
    this.inString = false
    this.escapeNext = false
    this.braceCount = 0
    this.jsonStart = -1
  }

  /** Flush 剩余 buffer，尝试提取最后的不完整 JSON */
  flush(): JsonlParsedEvent[] {
    const events: JsonlParsedEvent[] = []
    const rest = this.buffer.trim()
    if (rest) {
      const parts = splitByEventBoundary(rest)
      if (parts.length <= 1) {
        // 单事件（或可修复的截断事件）：整体尝试
        const event = parseEvent(rest, this.onDebug)
        if (event) events.push(event)
      } else {
        // 多事件残留（残缺对象吞掉了后续事件，feed 在 lookahead
        // 暂停处截断）：按事件边界切分，逐段独立解析
        for (const part of parts) {
          const ev = parseEvent(part, this.onDebug)
          if (ev) events.push(ev)
        }
      }
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

/**
 * 按事件边界切分文本：以每个 {"event" 对象开头为界切成多段。
 * 仅用于 flush 兜底（多事件残留）；只匹配 {"event"（{"type" 是
 * 图表配置对象的常见字段，如 {"type":"line"}，不能作为事件边界）。
 * 字符串内出现 {"event 的误切会导致该段解析失败被跳过，属可接受的
 * 兜底代价。
 */
function splitByEventBoundary(text: string): string[] {
  const re = /\{"event"/g
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  // 从文本开头找切分点；开头本身若不是事件，则把开头到第一个事件的
  // 内容作为首段（通常是损坏残留，解析会失败被跳过）
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    last = m.index
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// ── Private helpers ────────────────────────────────────────────

/**
 * 解析一段完整 JSON，返回单个事件。
 *
 * 事件枚举协议：对象必须是 {"event"|"type": "summary"|"insights"|"report"|
 * "text"|"chart"|"table", ...} 信封，经 validateEvent 强校验后输出。
 */
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

// ── Event Schema 校验 ─────────────────────────────────────────
// 集中声明每类事件的字段约束（必填/类型/非空），validateEvent 的
// 解析产物统一经 checkSchema 把关，校验失败返回字段级错误信息。

interface SchemaField {
  required?: boolean
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  itemType?: 'string' | 'number' | 'object'
  nonEmpty?: boolean
}

type EventSchema = Record<string, SchemaField>

const EVENT_SCHEMAS: Record<string, EventSchema> = {
  summary: {
    content: { required: true, type: 'string', nonEmpty: true },
  },
  insights: {
    items: {
      required: true,
      type: 'array',
      itemType: 'string',
      nonEmpty: true,
    },
  },
  report: {
    content: { required: true, type: 'string', nonEmpty: true },
  },
  text: {
    content: { required: true, type: 'string', nonEmpty: true },
  },
  chart: {
    type: { required: true, type: 'string' },
    title: { required: true, type: 'string', nonEmpty: true },
    data: { required: true, type: 'array', itemType: 'object', nonEmpty: true },
  },
  table: {
    title: { required: true, type: 'string', nonEmpty: true },
    columns: {
      required: true,
      type: 'array',
      itemType: 'string',
      nonEmpty: true,
    },
    data: { required: true, type: 'array', itemType: 'object', nonEmpty: true },
  },
}

/** 按 schema 校验对象：通过返回 null，失败返回字段级错误信息 */
function checkSchema(schema: EventSchema, obj: any): string | null {
  for (const [field, rule] of Object.entries(schema)) {
    const v = obj?.[field]
    if (v === undefined || v === null) {
      if (rule.required) return `缺少必填字段 ${field}`
      continue
    }
    const actual = Array.isArray(v) ? 'array' : typeof v
    if (rule.type && actual !== rule.type) {
      return `${field} 类型错误: 期望 ${rule.type}，实际 ${actual}`
    }
    if (rule.itemType && Array.isArray(v)) {
      const bad = v.some(
        (x: any) => (Array.isArray(x) ? 'array' : typeof x) !== rule.itemType,
      )
      if (bad) return `${field} 元素类型错误: 期望 ${rule.itemType}`
    }
    if (rule.nonEmpty && actual === 'array' && v.length === 0) {
      return `${field} 不能为空数组`
    }
    if (rule.nonEmpty && actual === 'string' && !String(v).trim()) {
      return `${field} 不能为空字符串`
    }
  }
  return null
}

function validateEvent(
  obj: Record<string, any>,
  onDebug?: (msg: string) => void,
): JsonlParsedEvent | null {
  // 兼容 "event"/"type"/"evnt"（拼写错误）字段名，类型名做归一化
  // （statistical_summary → summary、analysis_result → report 等）
  const eventType = normalizeEventType(obj.event ?? obj.type ?? obj.evnt)

  switch (eventType) {
    case 'text':
    case 'report': {
      const d = obj.content ?? obj.delta ?? obj.data ?? obj.description
      // 内容字段兼容：字符串直接用；对象/数组（模型自创 data 结构）转文本
      const text = valueToText(d)
      if (!text) {
        onDebug?.(
          `[validate] ${eventType}: content/delta/data 为空或不可转文本 (type=${typeof d})`,
        )
        return null
      }
      const payload = { content: text }
      const schemaErr = checkSchema(EVENT_SCHEMAS[eventType], payload)
      if (schemaErr) {
        onDebug?.(`[validate] ${eventType}: ${schemaErr}`)
        return null
      }
      return { type: eventType, content: text }
    }

    case 'summary': {
      const d = obj.content ?? obj.delta ?? obj.data ?? obj.description
      const text = valueToText(d)
      if (!text) {
        onDebug?.(
          `[validate] summary: content/delta/data 为空或不可转文本 (type=${typeof d})`,
        )
        return null
      }
      const schemaErr = checkSchema(EVENT_SCHEMAS.summary, { content: text })
      if (schemaErr) {
        onDebug?.(`[validate] summary: ${schemaErr}`)
        return null
      }
      return { type: 'summary', content: text }
    }

    case 'insights': {
      const items = obj.items ?? obj.insights ?? obj.data ?? obj.description
      if (Array.isArray(items)) {
        // 元素兼容：字符串直接收；对象（如 {date, description}）转键值文本
        const converted = items
          .map((i) => valueToText(i))
          .filter((x): x is string => x !== null)
        if (converted.length > 0) {
          const schemaErr = checkSchema(EVENT_SCHEMAS.insights, {
            items: converted,
          })
          if (schemaErr) {
            onDebug?.(`[validate] insights: ${schemaErr}`)
            return null
          }
          return { type: 'insights', items: converted }
        }
      } else {
        const text = valueToText(items)
        if (text) {
          const schemaErr = checkSchema(EVENT_SCHEMAS.insights, {
            items: [text],
          })
          if (schemaErr) {
            onDebug?.(`[validate] insights: ${schemaErr}`)
            return null
          }
          return { type: 'insights', items: [text] }
        }
      }
      onDebug?.(
        `[validate] insights: items 为空或不可转 string[] (type=${typeof items})`,
      )
      return null
    }

    case 'chart': {
      // chart 内容兼容：标准 chart 信封，或模型自创的 {event, data} 结构
      const c = obj.chart ?? obj.data
      if (!c || typeof c !== 'object') {
        onDebug?.(
          `[validate] chart: 缺少 chart/data 字段，obj keys=${Object.keys(obj).join(',')}`,
        )
        return null
      }
      // type：显式归一化；缺失时按标题/x 轴维度推断（时间词 → line，否则 bar）
      const type = c.type ? normalizeChartType(c.type) : inferChartType(c)
      if (!type) {
        onDebug?.(
          `[validate] chart: chart.type 无法识别，keys=${Object.keys(c).join(',')}`,
        )
        return null
      }
      if (!c.title) {
        onDebug?.(
          `[validate] chart: 缺少 chart.title，keys=${Object.keys(c).join(',')}`,
        )
        return null
      }
      // data：行对象数组透传；ECharts option 风格或系列数组风格 → 转行对象数组
      const data = normalizeChartData(c)
      if (!data || data.length === 0) {
        onDebug?.(
          `[validate] chart: chart.data 为空或不可转换，keys=${Object.keys(c).join(',')}`,
        )
        return null
      }
      const payload = { ...c, type, data }
      const schemaErr = checkSchema(EVENT_SCHEMAS.chart, payload)
      if (schemaErr) {
        onDebug?.(
          `[validate] chart: ${schemaErr}，keys=${Object.keys(c).join(',')}`,
        )
        return null
      }
      return { type: 'chart', payload }
    }

    case 'table': {
      // table 内容兼容：标准 table 信封，或 {event, data} 结构的单行对象
      const t = obj.table ?? obj.data
      if (!t || typeof t !== 'object') {
        onDebug?.(
          `[validate] table: 缺少 table/data 字段，obj keys=${Object.keys(obj).join(',')}`,
        )
        return null
      }
      // 标准结构：columns + data
      if (Array.isArray(t.columns) && Array.isArray(t.data)) {
        if (!t.title) {
          onDebug?.(
            `[validate] table: 缺少 table.title，keys=${Object.keys(t).join(',')}`,
          )
          return null
        }
        const schemaErr = checkSchema(EVENT_SCHEMAS.table, t)
        if (schemaErr) {
          onDebug?.(
            `[validate] table: ${schemaErr}，keys=${Object.keys(t).join(',')}`,
          )
          return null
        }
        return { type: 'table', payload: t as TableConfig }
      }
      // 单行对象（模型把一行明细直接铺在 data 里）→ 从 keys 推导列
      const columns = Object.keys(t).filter((k) => k !== 'id' && k !== 'title')
      if (columns.length > 0) {
        const payload = {
          id: typeof t.id === 'string' ? t.id : 't1',
          title: typeof t.title === 'string' ? t.title : '数据表格',
          columns,
          data: [t],
        }
        const schemaErr = checkSchema(EVENT_SCHEMAS.table, payload)
        if (schemaErr) {
          onDebug?.(
            `[validate] table: ${schemaErr}，keys=${Object.keys(t).join(',')}`,
          )
          return null
        }
        return { type: 'table', payload: payload as TableConfig }
      }
      onDebug?.(
        `[validate] table: 无 columns/data，keys=${Object.keys(t).join(',')}`,
      )
      return null
    }

    default: {
      // 兼容模型自创事件类型（如 recommendations、summary_conclusion）：
      // 不依赖 eventType 识别——只要 data 是字符串数组就归一为 summary。
      // （值统一由 summary 通道输出，避免未知名事件被整体丢弃）
      if (
        Array.isArray(obj.data) &&
        obj.data.every((i: any) => typeof i === 'string')
      ) {
        const text = valueToText(obj.data)
        if (text) return { type: 'summary', content: text }
      }
      onDebug?.(
        `[validate] 未知 event 类型: "${eventType}"，obj keys=${Object.keys(obj).join(',')}`,
      )
      return null
    }
  }
}

// ── 内容转换 helpers（兼容模型自创的 {event, data} 输出）──────────

/**
 * 事件类型名归一化：接受大小写/下划线/中划线变体，以及语义相近的自创名
 * （statistical_summary → summary、analysis_result → report、recommendations
 * → report 等）。识别失败返回 null。
 */
function normalizeEventType(raw: unknown): string | null {
  const k = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]/g, '')
  switch (k) {
    case 'summary':
    case 'statisticalsummary':
    case 'analysisummary':
    case 'summarize':
    case 'summarization':
    case 'summaryconclusion':
    case 'conclusion':
    case '总结':
    case '摘要':
    case '结论摘要':
      return 'summary'
    case 'insights':
    case 'insight':
    case 'keyinsights':
    case 'findings':
    case '发现':
    case '关键发现':
      return 'insights'
    case 'report':
    case 'analysisresult':
    case 'result':
    case 'analysis':
    case 'conclusion':
    case 'recommendations':
    case 'recommendation':
    case '建议':
    case '结论':
    case '分析报告':
      return 'report'
    case 'text':
    case 'content':
    case 'message':
      return 'text'
    case 'chart':
    case 'charts':
    case 'graph':
    case 'visualization':
    case 'trendchart':
    case 'trend':
    case '图表':
    case '图形':
    case '趋势图':
    case '走势图':
      return 'chart'
    case 'table':
    case 'tables':
    case '表格':
      return 'table'
    default:
      return null
  }
}

/** 任意值 → 可读文本：字符串原样；数组逐元素转文本拼接；对象键值对拼接 */
function valueToText(v: any): string | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    return t || null
  }
  if (Array.isArray(v)) {
    const parts = v.map((x) => valueToText(x)).filter(Boolean)
    return parts.length > 0 ? parts.join('；') : null
  }
  if (typeof v === 'object') {
    const parts = Object.entries(v).map(([k, val]) => {
      const tv = valueToText(val)
      return tv ? `${k}: ${tv}` : null
    })
    return parts.filter(Boolean).length > 0
      ? parts.filter(Boolean).join(', ')
      : null
  }
  return String(v)
}

/** 图表类型归一化：接受大小写与常见变体（LineChart → line） */
function normalizeChartType(raw: string): string | null {
  const k = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  switch (k) {
    case 'line':
    case 'linechart':
    case 'lines':
      return 'line'
    case 'bar':
    case 'barchart':
    case 'column':
    case 'bars':
      return 'bar'
    case 'pie':
    case 'piechart':
    case 'donut':
      return 'pie'
    default:
      return null
  }
}

/** type 缺失时推断：标题/x 轴含时间维度特征 → line，否则 bar */
function inferChartType(c: any): string | null {
  const raw = String(c.title ?? '') + JSON.stringify(c.x_axis ?? c.xAxis ?? '')
  return /日期|时间|月份|季度|年份|年月|date|month|year|time|趋势/i.test(raw)
    ? 'line'
    : 'bar'
}

/**
 * 图表 data 归一化为行对象数组：
 * 1. data 已是行对象数组 → 透传
 * 2. ECharts option 风格 {xAxis/yAxis/data} → 二维数组按系列 zip
 * 3. 模型自创系列数组风格 {x_axis, y_axis, line|bar|pie: [{key: [...]}]} → 按索引 zip
 * 4. 模型自创 points 风格 {series: [{name, points: [{x, y}]}]} → 逐点转行
 */
function normalizeChartData(c: any): any[] | null {
  if (
    Array.isArray(c.data) &&
    c.data.length > 0 &&
    c.data.every((d: any) => d && typeof d === 'object' && !Array.isArray(d))
  ) {
    return c.data
  }
  const seriesArr = c.line ?? c.bar ?? c.pie
  if (c.x_axis && Array.isArray(seriesArr)) {
    return seriesToRowData(c)
  }
  if (Array.isArray(c.series)) {
    return seriesPointsToRowData(c)
  }
  return toRowData(c)
}

/**
 * series 数组风格转行对象数组（两种子格式并存）：
 * A. points 风格：{"title":..., "series":[{"name":"饮料","points":[{"x":"2026-01-01","y":11012.11}]}]}
 *    X 轴列名取 x_axisTitle/xAxisTitle（缺省"日期"），每点 {x,y} 转一行，
 *    Y 轴列名取系列 name。
 * B. values 风格：{"x_axis":"日期","series":[{"name":"饮料","values":[11012.11,...]}]}
 *    各系列 values 等长数组按索引 zip 成行（同一 x 序号跨系列对齐），
 *    X 轴列名取 x_axis/xAxis（缺省"日期"）；AI 未提供 x 轴数据时用序号 1..N 兜底。
 */
function seriesPointsToRowData(c: any): any[] | null {
  if (!Array.isArray(c.series) || c.series.length === 0) return null
  const xKey =
    (typeof c.x_axis === 'string' && c.x_axis.trim() ? c.x_axis : null) ??
    (typeof c.xAxis === 'string' && c.xAxis.trim() ? c.xAxis : null) ??
    (typeof c.x_axisTitle === 'string' ? c.x_axisTitle : null) ??
    (typeof c.xAxisTitle === 'string' ? c.xAxisTitle : null) ??
    '日期'
  const rows: any[] = []

  // 格式 A：每点 {x, y} 转一行
  for (const s of c.series) {
    if (!s || !Array.isArray(s.points)) continue
    const name = typeof s.name === 'string' && s.name.trim() ? s.name : '系列'
    for (const pt of s.points) {
      if (!pt || typeof pt !== 'object') continue
      const row: any = {
        [xKey]: pt.x ?? pt.date ?? pt[0] ?? null,
      }
      row[name] = pt.y ?? pt.value ?? pt[1] ?? null
      rows.push(row)
    }
  }

  // 格式 B：values 等长数组按索引 zip 成行
  const valueSeries: { name: string; values: any[] }[] = []
  for (const s of c.series) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.values)) continue
    const name = typeof s.name === 'string' && s.name.trim() ? s.name : '系列'
    if (s.values.length > 0) valueSeries.push({ name, values: s.values })
  }
  if (valueSeries.length > 0) {
    const n = Math.max(...valueSeries.map((s) => s.values.length))
    for (let i = 0; i < n; i++) {
      const row: any = { [xKey]: i + 1 }
      for (const s of valueSeries) row[s.name] = s.values[i] ?? null
      rows.push(row)
    }
  }

  return rows.length > 0 ? rows : null
}

/**
 * 系列数组风格转行对象数组：
 * {"x_axis":"日期","y_axis":"销售额(元)","line":[{"date":[...],"sales":[...]}]}
 * 每个系列对象含多个等长数组：X 轴数据取键名含时间特征的数组（否则第一个），
 * X 轴列名取 x_axis；其余数组为数值系列，列名取 y_axis（单个）或键名。
 */
function seriesToRowData(c: any): any[] | null {
  const series = c.line ?? c.bar ?? c.pie
  if (!Array.isArray(series) || series.length === 0) return null
  const xKey = typeof c.x_axis === 'string' ? c.x_axis : '维度'
  const yKey = typeof c.y_axis === 'string' ? c.y_axis : null
  const rows: any[] = []
  for (const s of series) {
    if (!s || typeof s !== 'object') continue
    const arrays = Object.entries(s).filter(([, v]) => Array.isArray(v))
    if (arrays.length === 0) continue
    const xIdx = arrays.findIndex(([k]) =>
      /date|时间|日期|月份|季度|年份|year|month|day/i.test(k),
    )
    const xi = xIdx >= 0 ? xIdx : 0
    const xArr = arrays[xi][1] as any[]
    for (let i = 0; i < xArr.length; i++) {
      const row: any = { [xKey]: xArr[i] }
      arrays.forEach(([k, arr], idx) => {
        if (idx === xi) return
        row[yKey ?? k] = (arr as any[])[i] ?? null
      })
      rows.push(row)
    }
  }
  return rows.length > 0 ? rows : null
}

/**
 * ECharts option 风格转行对象数组：
 * 支持 {xAxis, yAxis, data}（兼容 x_axis / y_axis 下划线变体）——
 * data 为二维数组（每列一个系列，系列名取 yAxis）或 {系列名: [values]} 对象。
 */
function toRowData(c: any): any[] | null {
  // x 轴值
  let xValues: any[] | null = null
  const xAxis = c.xAxis ?? c.x_axis
  if (Array.isArray(xAxis)) xValues = xAxis
  else if (xAxis && typeof xAxis === 'object' && Array.isArray(xAxis.data)) {
    xValues = xAxis.data
  }

  // 系列名（yAxis 字符串 / 数组 / 对象 title.text / name）
  const yAxis = c.yAxis ?? c.y_axis
  const seriesNames: string[] = []
  if (typeof yAxis === 'string') seriesNames.push(yAxis)
  else if (Array.isArray(yAxis)) {
    seriesNames.push(...yAxis.filter((y: any) => typeof y === 'string'))
  } else if (yAxis && typeof yAxis === 'object') {
    const t = yAxis.title?.text ?? yAxis.name
    if (typeof t === 'string') seriesNames.push(t)
  }

  // 系列数据
  const series: { name: string; values: any[] }[] = []
  if (Array.isArray(c.data)) {
    if (c.data.length > 0 && c.data.every((d: any) => Array.isArray(d))) {
      // 二维数组：每行一个系列
      c.data.forEach((row: any[], i) => {
        series.push({
          name: seriesNames[i] ?? `系列${i + 1}`,
          values: row,
        })
      })
    }
  } else if (c.data && typeof c.data === 'object') {
    // {系列名: [values]}
    for (const [name, values] of Object.entries(c.data)) {
      if (Array.isArray(values)) series.push({ name, values })
    }
  }

  if (series.length === 0) return null
  const n = Math.max(...series.map((s) => s.values.length))
  const xKey = typeof xAxis === 'string' ? xAxis : '日期'
  const rows: any[] = []
  for (let i = 0; i < n; i++) {
    const row: any = { [xKey]: xValues?.[i] ?? i + 1 }
    for (const s of series) row[s.name] = s.values[i] ?? null
    rows.push(row)
  }
  return rows
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

  // Step 6: 结构修复——模型把对象闭合 } 误写成 ]（或数组闭合 ] 误写成 }）、
  // 输出被截断时，逐轮修复并用 JSON.parse 验证
  const structural = repairStructuralErrors(fixed)
  if (structural) return structural

  if (fixed !== raw.trim()) return fixed
  return null
}

/**
 * 结构修复：处理 LLM 常见的括号错位与输出截断。
 * - 对象闭合 } 被误写成 ]：V8 报 "Expected ',' or '}' ... position N"，N 处为 ] → 替换为 }
 * - 数组闭合 ] 被误写成 }：V8 报 "Expected ',' or ']' ... position N"，N 处为 } → 替换为 ]
 * - 输出截断：报 "Unexpected end of JSON input" → 按括号栈补齐缺失的闭合符号
 * 每轮修复后用 JSON.parse 验证，失败则继续下一轮，最多 5 轮；全部失败返回 null。
 */
function repairStructuralErrors(json: string): string | null {
  let current = json
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      JSON.parse(current)
      // 未做任何修改（原始就合法）或修复成功
      return current === json ? null : current
    } catch (err: any) {
      const msg: string = err?.message || ''
      const m = /position (\d+)/.exec(msg)
      const p = m ? Number(m[1]) : -1
      const ch = p >= 0 && p < current.length ? current[p] : ''

      // 对象闭合 } 被误写成 ]（如 {"a":1,"data":[...] ] 少了一个 }）
      if (/Expected ',' or '\}'/.test(msg) && ch === ']') {
        current = current.slice(0, p) + '}' + current.slice(p + 1)
        continue
      }
      // 对象闭合 } 缺失且截断在末尾（字符串修复后的常见后续报错）
      if (/Expected ',' or '\}'/.test(msg) && ch === '') {
        current += '}'
        continue
      }
      // 数组闭合 ] 被误写成 }
      if (/Expected ',' or '\]'/.test(msg) && ch === '}') {
        current = current.slice(0, p) + ']' + current.slice(p + 1)
        continue
      }
      // 数组闭合 ] 缺失且截断在末尾
      if (/Expected ',' or '\]'/.test(msg) && ch === '') {
        current += ']'
        continue
      }
      // 对象闭合后还有多余内容（残缺对象吞掉了后续事件文本）：
      // 截断到报错位置，丢弃溢出部分，避免整体解析失败
      if (/Unexpected non-whitespace character after JSON/.test(msg)) {
        current = current.slice(0, p).trimEnd()
        continue
      }
      // 输出截断在字符串内部：末尾补闭合引号（V8 报字符串开始位置，
      // 但截断发生在末尾），下一轮再走 Unexpected end 分支补闭合符号
      if (/Unterminated string in JSON/.test(msg)) {
        current += '"'
        continue
      }
      // 输出截断：补齐缺失的闭合符号
      if (/Unexpected end of JSON input/.test(msg)) {
        const closers = getMissingClosers(current)
        if (!closers) return null
        current += closers
        continue
      }
      return null
    }
  }
  return null
}

/**
 * 扫描括号栈，返回字符串末尾缺失的闭合符号（如 "}]"）。
 * 遇到无法配对的闭合符号（栈错乱）返回空串，表示无法简单补齐。
 */
function getMissingClosers(json: string): string {
  const stack: string[] = []
  let inString = false
  let escapeNext = false
  for (const ch of json) {
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (ch === '\\') {
      escapeNext = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop()
      else return ''
    }
  }
  return stack.reverse().join('')
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
