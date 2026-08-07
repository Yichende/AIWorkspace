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

// ── SSE Event Types ────────────────────────────────────────────

export type AnalysisEventType = 'status' | 'text' | 'chart' | 'table' | 'complete' | 'error'

export interface AnalysisSSEEvent {
  type: AnalysisEventType
  content: string // status message, text delta, or JSON string for chart/table/complete
}

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

// ── Dataset ────────────────────────────────────────────────────

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
