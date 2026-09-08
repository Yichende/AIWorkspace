import Taro from '@tarojs/taro'
import type { CreateSessionParams, CreateMessageParams, UpdateMessageParams, UpdateSessionParams, PaginatedSessions, MessageListResponse } from '@repo/types'
import { DEFAULT_PAGE_SIZE } from '@repo/constants'
import { getToken, getRefreshToken, setToken, setRefreshToken } from '@/utils/auth'
import { isTokenExpiringSoon } from '@/utils/token-check'
import { SseFrameReader } from '@/utils/sse'
import type { SseFrame } from '@/utils/sse'
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
  /** RequestTask 创建完成即同步回调 — 调用方可持有它用于 abort() 中断流 */
  onTaskReady?: (task: Taro.RequestTask<any>) => void
}

// ── API ────────────────────────────────────────────────────

export const chatApi = {
  /** 分页获取会话列表（仅元数据，无消息体），keyword 按标题模糊搜索 */
  listSessions(
    page = 1,
    limit = DEFAULT_PAGE_SIZE,
    keyword?: string,
  ): Promise<PaginatedSessions> {
    const data: Record<string, any> = { page, limit }
    if (keyword) {
      data.keyword = keyword
    }
    return request({
      url: '/chat/sessions',
      method: 'GET',
      data,
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
   * 注意：RequestTask 是 thenable（Promise 子类），async 返回会被解包，
   * 因此不能通过 await 返回值拿到它 —— 统一通过 onTaskReady 回调获取以支持 abort()。
   * 本 promise 仅在请求结束时 settle（success/fail），可 await 作流程控制。
   */
  async streamCompletion(
    model: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
  ): Promise<void> {
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

    // 共享收流骨架：增量 UTF-8 解码（跨 chunk 字节残留）+ \n\n 拆帧留尾 + 分发完整帧
    const reader = new SseFrameReader((frame) => {
      chatApi._dispatchFrame(frame, callbacks)
    })

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
        // Stream complete — flush decode tail + any unterminated final frame
        reader.end()
      },
      fail: (err) => {
        callbacks.onError?.(err.errMsg || 'Stream request failed')
      },
    })

    // WeChat Mini Program chunk listener
    ;(requestTask as any).onChunkReceived?.((res: { data: ArrayBuffer }) => {
      reader.feed(res.data)
    })

    // 同步把 RequestTask 交给调用方（用于 abort 中断）
    callbacks.onTaskReady?.(requestTask)

    // Promise.resolve(thenable) 会采纳 RequestTask —— settle 时机即请求结束
    return Promise.resolve(requestTask) as unknown as Promise<void>
  },

  // ── Internal helpers ─────────────────────────────────────

  /** SSE 帧分发（业务事件表；未知事件兜底为 content）—— 解码/拆帧在 utils/sse.ts */
  _dispatchFrame(frame: SseFrame, cb: StreamCallbacks): void {
    switch (frame.event) {
      case 'thinking':
        cb.onThinking?.(frame.data)
        break
      case 'content':
        cb.onContent?.(frame.data)
        break
      case 'done':
        cb.onDone?.(frame.data)
        break
      case 'error':
        cb.onError?.(frame.data)
        break
      default:
        // Unknown event (or event-less frame) — treat as content
        if (frame.data) cb.onContent?.(frame.data)
    }
  },
}
