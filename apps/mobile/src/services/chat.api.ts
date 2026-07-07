import type { ChatMessage } from '@/types/chat'
import request from './request'

// ── Response types ──────────────────────────────────────────

export interface SessionIndexItem {
  id: string
  title: string
  model: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

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

// ── API ────────────────────────────────────────────────────

export const chatApi = {
  /** 分页获取会话列表（仅元数据，无消息体） */
  listSessions(page = 1, limit = 20): Promise<PaginatedSessions> {
    return request({
      url: '/chat/sessions',
      method: 'GET',
      data: { page, limit },
    })
  },

  /** 创建会话 + 可选初始消息 */
  createSession(session: {
    id: string
    title?: string
    model: string
    messages?: ChatMessage[]
  }) {
    return request({
      url: '/chat/sessions',
      method: 'POST',
      data: session,
    })
  },

  /** 删除会话 */
  deleteSession(id: string) {
    return request({
      url: `/chat/sessions/${id}`,
      method: 'DELETE',
    })
  },

  /** 游标分页获取消息 */
  listMessages(
    sessionId: string,
    before?: number,
    limit = 20,
  ): Promise<MessageListResponse> {
    return request({
      url: `/chat/sessions/${sessionId}/messages`,
      method: 'GET',
      data: { before, limit },
    })
  },

  /** 保存单条消息（upsert，幂等） */
  saveMessage(
    sessionId: string,
    message: { id: string; role: string; blocks: any[]; status?: string; createdAt?: number },
  ) {
    return request({
      url: `/chat/sessions/${sessionId}/messages`,
      method: 'POST',
      data: message,
    })
  },

  /** 更新单条消息（流式结束后回写） */
  updateMessage(
    messageId: string,
    patch: { blocks?: ChatMessage['blocks']; status?: string },
  ) {
    return request({
      url: `/chat/messages/${messageId}`,
      method: 'PATCH',
      data: patch,
    })
  },
}
