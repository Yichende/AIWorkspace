// ── Analysis Page & Task Types ─────────────────────────────────

// ── Page State ─────────────────────────────────────────────────

/** 分析页面单页状态流转步骤 */
export type AnalysisStep = 'upload' | 'preview' | 'prompt' | 'analyzing' | 'result'

// ── Task Lifecycle ─────────────────────────────────────────────

/**
 * 分析任务生命周期：
 *   PENDING   → 已创建，等待执行
 *   ANALYZING → AI 正在分析
 *   COMPLETED → 分析成功完成
 *   FAILED    → 分析失败
 */
export type AnalysisStatus = 'PENDING' | 'ANALYZING' | 'COMPLETED' | 'FAILED'

// ── Progress Stage ─────────────────────────────────────────────

/** 分析流水线阶段（用于进度条） */
export type ProgressStage = 'upload' | 'parse' | 'profiling' | 'analyzing' | 'rendering'

// ── SSE Event Protocol (discriminated union) ───────────────────

export interface AnalysisThinkingEvent {
  type: 'thinking'
  delta: string
}

/** 分析摘要（规范化事件之一） */
export interface AnalysisSummaryEvent {
  type: 'summary'
  delta: string
}

/** 关键发现（规范化事件之一） */
export interface AnalysisInsightsEvent {
  type: 'insights'
  items: string[]
}

/** 分析报告正文章节（规范化事件之一） */
export interface AnalysisReportEvent {
  type: 'report'
  delta: string
}

/** 分析图表（规范化事件之一） */
export interface AnalysisChartEvent {
  type: 'chart'
  chart: ChartConfig
}

/** 分析表格（规范化事件之一） */
export interface AnalysisTableEvent {
  type: 'table'
  table: TableConfig
}

export interface AnalysisProgressEvent {
  type: 'progress'
  stage: ProgressStage
  percent: number
}

export interface AnalysisCompleteEvent {
  type: 'complete'
  payload: AnalysisResult
}

export interface AnalysisErrorEvent {
  type: 'error'
  message: string
}

/**
 * 规范化 SSE 事件协议：
 *   chart / table / report / insights / summary 分别对应分析图表、分析表格、分析报告、关键发现、分析摘要
 */
export type AnalysisEvent =
  | AnalysisThinkingEvent
  | AnalysisSummaryEvent
  | AnalysisInsightsEvent
  | AnalysisReportEvent
  | AnalysisChartEvent
  | AnalysisTableEvent
  | AnalysisProgressEvent
  | AnalysisCompleteEvent
  | AnalysisErrorEvent

// ── Chart & Table Config ───────────────────────────────────────

export interface ChartConfig {
  id: string
  type: 'line' | 'bar' | 'pie'
  title: string
  data: any[]
  /** 可选，透传 ECharts option 覆盖字段 */
  option?: object
}

export interface TableConfig {
  id: string
  title: string
  columns: string[]
  data: Record<string, any>[]
}

// ── Data Profiler Output ───────────────────────────────────────

/** 列元数据 */
export interface ColumnProfile {
  name: string
  type: 'number' | 'date' | 'string' | 'unknown'
  nullable: boolean
  uniqueCount?: number
}

/** 数值列统计 */
export interface NumericColumnStats {
  count: number
  min: number
  max: number
  mean: number
  median: number
  stdDev: number
  nullCount: number
}

/** Data Profiler 产出的数据摘要（作为 LLM Prompt 输入） */
export interface DataProfile {
  fileName: string
  rowCount: number
  columnCount: number
  columns: ColumnProfile[]
  statistics: Record<string, NumericColumnStats>
  sampleRows: Record<string, any>[]
}

// ── Dataset (upload response) ──────────────────────────────────

export interface DatasetSummary {
  columns: string[]
  rowCount: number
  columnCount: number
  /** 前 5 行预览数据 */
  preview: Record<string, any>[]
}

// ── Analysis Result ────────────────────────────────────────────

export interface AnalysisResult {
  summary: string
  content: string // Markdown
  charts: ChartConfig[]
  tables: TableConfig[]
  insights: string[]
}

// ── API Request DTOs ───────────────────────────────────────────

export interface CreateAnalysisParams {
  fileId: string
  prompt: string
  model?: string
}

export interface UploadFileResponse {
  fileId: string
  fileName: string
  dataset: DatasetSummary
}

export interface CreateAnalysisResponse {
  id: string
  status: 'PENDING'
}

// ── API Response DTOs ──────────────────────────────────────────

export interface AnalysisListItem {
  id: string
  title: string
  fileName?: string
  chartCount: number
  status: AnalysisStatus
  createdAt: string
}

export interface PaginatedAnalyses {
  items: AnalysisListItem[]
  page: number
  total: number
  hasMore: boolean
}

export interface AnalysisDetail {
  session: {
    id: string
    title: string
    status: AnalysisStatus
    model: string
    createdAt: string
  }
  file?: {
    fileName: string
    size: number
  }
  charts: ChartConfig[]
  tables: TableConfig[]
  result: AnalysisResult | null
}
