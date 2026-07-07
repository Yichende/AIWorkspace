import type { CreateSessionParams, CreateMessageParams, UpdateMessageParams , PaginatedSessions, MessageListResponse } from '@repo/types'
import { DEFAULT_PAGE_SIZE } from '@repo/constants'
import request from './request'

// Re-export for backward compatibility
export type { SessionIndexItem } from '@repo/types'
export type { PaginatedSessions, MessageListResponse } from '@repo/types'

// ── API ────────────────────────────────────────────────────

export const chatApi = {
  /** 分页获取会话列表（仅元数据，无消息体） */
  listSessions(page = 1, limit = DEFAULT_PAGE_SIZE): Promise<PaginatedSessions> {
    return request({
      url: '/chat/sessions',
      method: 'GET',
      data: { page, limit },
    })
  },

  /** 创建会话 + 可选初始消息 */
  createSession(session: CreateSessionParams) {
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
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<MessageListResponse> {
    return request({
      url: `/chat/sessions/${sessionId}/messages`,
      method: 'GET',
      data: { before, limit },
    })
  },

  /** 保存单条消息（upsert，幂等） */
  saveMessage(sessionId: string, message: CreateMessageParams) {
    return request({
      url: `/chat/sessions/${sessionId}/messages`,
      method: 'POST',
      data: message,
    })
  },

  /** 更新单条消息（流式结束后回写） */
  updateMessage(messageId: string, patch: UpdateMessageParams) {
    return request({
      url: `/chat/messages/${messageId}`,
      method: 'PATCH',
      data: patch,
    })
  },
}
