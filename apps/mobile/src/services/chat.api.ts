import Taro from '@tarojs/taro'
import type { CreateSessionParams, CreateMessageParams, UpdateMessageParams, UpdateSessionParams, PaginatedSessions, MessageListResponse } from '@repo/types'
import { DEFAULT_PAGE_SIZE } from '@repo/constants'
import { getToken, getRefreshToken, setToken, setRefreshToken } from '@/utils/auth'
import { isTokenExpiringSoon } from '@/utils/token-check'
import { useUserStore } from '@/stores/user.store'
import request from './request'

// Re-export for backward compatibility
export type { SessionIndexItem } from '@repo/types'
export type { PaginatedSessions, MessageListResponse } from '@repo/types'

const BASE_URL = 'http://localhost:3000'

// ── SSE Stream Callbacks ────────────────────────────────────

export interface StreamCallbacks {
  onThinking?: (text: string) => void
  onContent?: (text: string) => void
  onDone?: (fullText: string) => void
  onError?: (err: string) => void
}

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

  /** 更新会话（重命名） */
  updateSession(id: string, patch: UpdateSessionParams) {
    return request({
      url: `/chat/sessions/${id}`,
      method: 'PATCH',
      data: patch,
    })
  },

  /** 游标分页获取消息 */
  listMessages(
    sessionId: string,
    before?: number,
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<MessageListResponse> {
    const data: Record<string, any> = { limit }
    if (before !== undefined) {
      data.before = before
    }
    return request({
      url: `/chat/sessions/${sessionId}/messages`,
      method: 'GET',
      data,
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

  /**
   * SSE 流式对话（通过 enableChunked 接收分块数据）。
   * 微信小程序兼容：使用 Taro.request 的 enableChunked + onChunkReceived。
   *
   * @returns 返回 RequestTask，可用于 abort()
   */
  async streamCompletion(
    model: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<Taro.RequestTask<any>> {
    const reqUrl = `${BASE_URL}/chat/completions`
    let token = await getToken()

    // ── Pre-check: refresh token if expiring soon (avoids mid-stream 401) ──
    if (token && isTokenExpiringSoon(token, 30000)) {
      try {
        const refreshToken = await getRefreshToken()
        if (refreshToken) {
          const refreshRes = await Taro.request<{
            access_token: string
            refresh_token: string
          }>({
            url: `${BASE_URL}/auth/refresh`,
            method: 'POST',
            data: { refresh_token: refreshToken },
            header: { 'Content-Type': 'application/json' },
          })

          if (
            refreshRes.statusCode >= 200 &&
            refreshRes.statusCode < 300
          ) {
            const { access_token, refresh_token } = refreshRes.data
            await setToken(access_token)
            await setRefreshToken(refresh_token)
            useUserStore.getState().setToken(access_token)
            useUserStore.getState().setRefreshToken(refresh_token)
            token = access_token
          }
        }
      } catch {
        // Refresh failed — proceed with existing token (will 401 if expired)
      }
    }

    let buffer = ''

    const requestTask = Taro.request({
      url: reqUrl,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': token ? `Bearer ${token}` : '',
      },
      data: { model, messages },
      enableChunked: true,
      responseType: 'arraybuffer',
      enableHttp2: false,
      success: () => {
        // Stream complete — process any remaining buffer
        if (buffer.trim()) {
          chatApi._processBuffer(buffer, callbacks)
        }
      },
      fail: (err) => {
        callbacks.onError?.(err.errMsg || 'Stream request failed')
      },
    })

    // WeChat Mini Program chunk listener
    ;(requestTask as any).onChunkReceived?.((res: { data: ArrayBuffer }) => {
      const text = chatApi._arrayBufferToString(res.data)
      buffer += text

      // Split on double newline (SSE message boundary)
      const parts = buffer.split('\n\n')
      // Last part may be incomplete — keep in buffer
      buffer = parts.pop() || ''

      for (const part of parts) {
        if (!part.trim()) continue
        chatApi._processSSEMessage(part, callbacks)
      }
    })

    return Promise.resolve(requestTask)
  },

  // ── Internal helpers ─────────────────────────────────────

  /** Process a single SSE message (event + data lines) */
  _processSSEMessage(raw: string, cb: StreamCallbacks): void {
    let eventType = ''
    let data = ''

    const lines = raw.split('\n')
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        // Preserve newlines between consecutive data lines
        if (data) data += '\n'
        data += line.slice(6)
      }
    }

    switch (eventType) {
      case 'thinking':
        cb.onThinking?.(data)
        break
      case 'content':
        cb.onContent?.(data)
        break
      case 'done':
        cb.onDone?.(data)
        break
      case 'error':
        cb.onError?.(data)
        break
      default:
        // Unknown event — treat as content
        if (data) cb.onContent?.(data)
    }
  },

  /** Process remaining buffer after stream ends */
  _processBuffer(raw: string, cb: StreamCallbacks): void {
    chatApi._processSSEMessage(raw, cb)
  },

  /** Convert ArrayBuffer to UTF-8 string (no TextDecoder in WeChat) */
  _arrayBufferToString(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let result = ''
    let i = 0
    while (i < bytes.length) {
      const byte = bytes[i++]
      if (byte < 0x80) {
        result += String.fromCharCode(byte)
      } else if (byte >= 0xC0 && byte < 0xE0) {
        const byte2 = bytes[i++]
        result += String.fromCharCode(((byte & 0x1F) << 6) | (byte2 & 0x3F))
      } else if (byte >= 0xE0 && byte < 0xF0) {
        const byte2 = bytes[i++]
        const byte3 = bytes[i++]
        result += String.fromCharCode(
          ((byte & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F),
        )
      } else if (byte >= 0xF0) {
        // 4-byte UTF-8 (surrogate pair)
        const byte2 = bytes[i++]
        const byte3 = bytes[i++]
        const byte4 = bytes[i++]
        const cp =
          ((byte & 0x07) << 18) |
          ((byte2 & 0x3F) << 12) |
          ((byte3 & 0x3F) << 6) |
          (byte4 & 0x3F)
        result += String.fromCharCode(
          0xD800 + ((cp - 0x10000) >> 10),
          0xDC00 + ((cp - 0x10000) & 0x3FF),
        )
      }
    }
    return result
  },
}
