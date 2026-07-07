import type { ChatMessage, MessageBlock, MessageRole, MessageStatus, SessionIndexItem } from './chat'

// ── Response types ────────────────────────────────────────────

export interface PaginatedSessions {
  items: SessionIndexItem[]
  total: number
  page: number
  limit: number
}

export interface MessageListResponse {
  messages: ChatMessage[]
  hasMore: boolean
}

// ── Request params / DTO shapes (pure types, no decorators) ──

export interface CreateSessionParams {
  id: string
  title?: string
  model: string
  messages?: CreateMessageParams[]
}

export interface CreateMessageParams {
  id: string
  role: MessageRole
  blocks: MessageBlock[]
  status?: MessageStatus
  createdAt?: number
}

export interface UpdateMessageParams {
  blocks?: MessageBlock[]
  status?: MessageStatus
}

export interface QuerySessionsParams {
  page?: number
  limit?: number
}

export interface QueryMessagesParams {
  before?: number
  limit?: number
}
