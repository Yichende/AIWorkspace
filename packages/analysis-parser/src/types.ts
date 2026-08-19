import type { ChartConfig, TableConfig } from '@repo/types'
export type { ChartConfig, TableConfig }

// ── Think Tag Parser Types ────────────────────────────────────

export interface ThinkChunk {
  type: 'thinking' | 'answer'
  content: string
}

// ── JSONL Stream Parser Types ─────────────────────────────────

export interface JsonlTextEvent {
  type: 'text'
  content: string
}

/** 分析摘要（text 事件的规范化替代） */
export interface JsonlSummaryEvent {
  type: 'summary'
  content: string
}

/** 关键发现（列表形式） */
export interface JsonlInsightsEvent {
  type: 'insights'
  items: string[]
}

/** 分析报告正文章节（text 事件的规范化替代） */
export interface JsonlReportEvent {
  type: 'report'
  content: string
}

export interface JsonlChartEvent {
  type: 'chart'
  payload: ChartConfig
}

export interface JsonlTableEvent {
  type: 'table'
  payload: TableConfig
}

export type JsonlParsedEvent =
  | JsonlTextEvent
  | JsonlSummaryEvent
  | JsonlInsightsEvent
  | JsonlReportEvent
  | JsonlChartEvent
  | JsonlTableEvent

// ── Parser Options ────────────────────────────────────────────

export interface JsonlStreamParserOptions {
  /** Optional debug callback (replaces NestJS Logger) */
  onDebug?: (msg: string) => void
}
