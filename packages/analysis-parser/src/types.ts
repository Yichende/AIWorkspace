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
  | JsonlChartEvent
  | JsonlTableEvent

// ── Parser Options ────────────────────────────────────────────

export interface JsonlStreamParserOptions {
  /** Optional debug callback (replaces NestJS Logger) */
  onDebug?: (msg: string) => void
}
