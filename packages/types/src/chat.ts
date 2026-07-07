// ── Message Block System ──────────────────────────────────────

export type BlockType = 'text' | 'code' | 'table' | 'chart' | 'custom'

export interface TextBlock {
  type: 'text'
  content: string
}

export interface CodeBlock {
  type: 'code'
  language: string
  content: string
}

export interface TableBlock {
  type: 'table'
  columns: string[]
  data: Record<string, any>[]
}

export interface ChartBlock {
  type: 'chart'
  option: any
}

export interface CustomBlock {
  type: 'custom'
  payload: any
}

export type MessageBlock =
  | TextBlock
  | CodeBlock
  | TableBlock
  | ChartBlock
  | CustomBlock

// ── Message ───────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant'

export type MessageStatus = 'sending' | 'streaming' | 'success' | 'error'

export interface ChatMessage {
  id: string
  role: MessageRole
  blocks: MessageBlock[]
  status: MessageStatus
  createdAt: number
}

// ── Session ───────────────────────────────────────────────────

/** Lightweight session metadata for sidebar lists (no messages) */
export interface SessionIndexItem {
  id: string
  title: string
  model: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

/** Full session including messages (used for legacy migration) */
export interface ChatSession {
  id: string
  title: string
  model: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ── History Grouping (sidebar) ────────────────────────────────

export type TimeGroup = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

export interface ChatHistoryItem {
  id: string
  title: string
  createdAt: number
  model: string
}

export interface ChatHistoryGroup {
  label: string
  group: TimeGroup
  items: ChatHistoryItem[]
}
