import type {
  ChatMessage,
  MessageBlock,
  MessageRole,
  MessageStatus,
  SessionIndexItem,
} from './chat'
import type { ProtocolType, ModelListItem } from './model'

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

export interface UpdateSessionParams {
  title?: string
  /** 会话中途切换模型时同步（服务端会话 model 默认冻结在创建时） */
  model?: string
}

// ── Custom User Model types ───────────────────────────────────

export interface CreateUserModelRequest {
  displayName: string
  protocolType: ProtocolType
  provider?: string
  apiModelName: string
  apiKey?: string
  apiBaseUrl?: string
  supportsThinking?: boolean
  notes?: string
}

export interface UserModelResponse {
  id: string
  displayName: string
  protocolType: ProtocolType
  provider?: string
  apiModelName: string
  apiBaseUrl?: string
  supportsThinking: boolean
  notes?: string
  isActive: boolean
  createdAt: number
  /** 是否已保存 API Key（仅布尔，绝不回传 key 本身） */
  hasApiKey?: boolean
}

export interface UpdateUserModelRequest {
  displayName?: string
  provider?: string
  apiModelName?: string
  apiKey?: string
  apiBaseUrl?: string
  supportsThinking?: boolean
  notes?: string
}

export interface ModelTestRequest {
  protocolType: ProtocolType
  apiModelName: string
  apiKey?: string
  apiBaseUrl?: string
  /** 编辑态测试：留空 apiKey 时携带 modelId，服务端回退使用存库 key */
  modelId?: string
}

export interface ModelTestResult {
  available: boolean
  latency?: number
  error?: string
}

export interface ModelListResponse {
  models: ModelListItem[]
}
