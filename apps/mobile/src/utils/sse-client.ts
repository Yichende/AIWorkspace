import Taro from '@tarojs/taro'
import { SseFrameReader } from '@/utils/sse'
import type { SseFrame } from '@/utils/sse'
import { getValidAccessToken } from '@/services/token-refresh'

export interface SseClientCallbacks {
  /** 每收到一个完整 SSE 帧调用（业务事件分发由各 service 自己实现） */
  onFrame: (frame: SseFrame) => void
  /** 传输层失败（errMsg 原文） */
  onError?: (err: string) => void
  /** 同步交付 RequestTask 句柄 —— 供调用方 abort() */
  onTaskReady?: (task: Taro.RequestTask<any>) => void
}

export interface SseClientOptions {
  url: string
  method?: 'GET' | 'POST'
  /** 请求体（仅 POST 有意义） */
  data?: unknown
}

/**
 * 小程序端 SSE 请求骨架。
 *
 * 把此前在 chat.api 与 analysis.api 各写一遍的「建请求 + 挂 chunk 监听 + 收尾」
 * 收敛到一处（两边原本约 35 行近乎逐字重复）。解码与拆帧仍在 utils/sse.ts，
 * 各 service 只保留自己的 `_dispatchFrame`（事件语义确实不同，不强行合并）。
 *
 * 关键约束（改动前请先读）：
 * - 必须经 `getValidAccessToken()` 取 token，**不要**直接调 `refreshAccessToken`：
 *   后者的「非 async + 同步赋值 refreshPromise」是同 tick 单飞的实现基础。
 * - `getValidAccessToken()` 永不抛（刷新失败会返回旧 token），所以这里没有
 *   额外的错误分支；调用方的 fire-and-forget 场景不会被未捕获拒绝打断。
 * - `RequestTask` 是 thenable，`Promise.resolve(task)` 会**采纳**它 —— settle
 *   时机是请求结束。因此句柄只能通过 `onTaskReady` 交付，不能靠 await 返回值。
 */
export async function createSSEClient(
  options: SseClientOptions,
  callbacks: SseClientCallbacks,
): Promise<void> {
  const { url, method = 'GET', data } = options
  // 临期则先刷新（单飞，避免流式请求中途 401）
  const token = await getValidAccessToken()

  const reader = new SseFrameReader((frame) => callbacks.onFrame(frame))

  const requestTask = Taro.request({
    url,
    method,
    header: {
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'text/event-stream',
      Authorization: token ? `Bearer ${token}` : '',
    },
    ...(data === undefined ? {} : { data }),
    enableChunked: true,
    responseType: 'arraybuffer',
    enableHttp2: false,
    success: () => {
      // 流正常结束：flush 解码残留 + 可能没有以 \n\n 收尾的尾帧
      reader.end()
    },
    fail: (err) => {
      callbacks.onError?.(err.errMsg || 'Stream request failed')
    },
  })

  // 微信小程序分块监听
  ;(requestTask as any).onChunkReceived?.((res: { data: ArrayBuffer }) => {
    reader.feed(res.data)
  })

  // 同步交付句柄（用于 abort 中断）
  callbacks.onTaskReady?.(requestTask)

  return Promise.resolve(requestTask) as unknown as Promise<void>
}
