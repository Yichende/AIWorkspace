import Taro from '@tarojs/taro'
import type {
  CreateAnalysisParams,
  CreateAnalysisResponse,
  UploadFileResponse,
  PaginatedAnalyses,
  AnalysisDetail,
  AnalysisResult,
  ChartConfig,
} from '@repo/types'
import { DEFAULT_PAGE_SIZE } from '@repo/constants'
import { getToken, getRefreshToken, setToken, setRefreshToken } from '@/utils/auth'
import { isTokenExpiringSoon } from '@/utils/token-check'
import { useUserStore } from '@/stores/user.store'
import request from './request'

const BASE_URL = 'http://localhost:3000'

// ── SSE Stream Callbacks（规范化四事件：summary/insights/report/chart）─

export interface AnalysisStreamCallbacks {
  onThinking?: (delta: string) => void
  /** 分析摘要 */
  onSummary?: (delta: string) => void
  /** 关键发现 */
  onInsights?: (items: string[]) => void
  /** 分析报告正文章节 */
  onReport?: (delta: string) => void
  /** 分析图表 */
  onChart?: (chart: ChartConfig) => void
  onProgress?: (stage: string, percent: number) => void
  onComplete?: (result: AnalysisResult) => void
  onError?: (err: string) => void
}

// ── API ────────────────────────────────────────────────────

export const analysisApi = {
  /**
   * 上传文件 → 服务端解析 → 返回 DatasetSummary
   */
  async upload(
    filePath: string,
    fileName: string,
  ): Promise<UploadFileResponse> {
    let token: string | null =
      useUserStore.getState().token || (await getToken())

    // Pre-check: refresh token if expiring soon
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
        // proceed with existing token
      }
    }

    return new Promise((resolve, reject) => {
      Taro.uploadFile({
        url: `${BASE_URL}/analysis/upload`,
        filePath,
        name: 'file',
        header: {
          Authorization: token ? `Bearer ${token}` : '',
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(res.data)
              resolve(data)
            } catch {
              reject(new Error('上传响应解析失败'))
            }
          } else {
            reject(new Error(res.data || '上传失败'))
          }
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '上传失败'))
        },
      })
    })
  },

  /**
   * 创建分析任务 (status=PENDING)
   */
  create(data: CreateAnalysisParams): Promise<CreateAnalysisResponse> {
    return request({
      url: '/analysis/create',
      method: 'POST',
      data,
    })
  },

  /**
   * SSE 流式分析（复用 chat.api.ts 的 enableChunked 模式）。
   *
   * 事件类型: status / text / chart / table / complete / error
   */
  async stream(
    id: string,
    callbacks: AnalysisStreamCallbacks,
  ): Promise<Taro.RequestTask<any>> {
    const reqUrl = `${BASE_URL}/analysis/${id}/stream`
    let token = await getToken()

    // Pre-check: refresh token if expiring soon
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
        // proceed with existing token
      }
    }

    let buffer = ''

    const requestTask = Taro.request({
      url: reqUrl,
      method: 'GET',
      header: {
        Accept: 'text/event-stream',
        Authorization: token ? `Bearer ${token}` : '',
      },
      enableChunked: true,
      responseType: 'arraybuffer',
      enableHttp2: false,
      success: () => {
        if (buffer.trim()) {
          analysisApi._processBuffer(buffer, callbacks)
        }
      },
      fail: (err) => {
        callbacks.onError?.(err.errMsg || 'Stream request failed')
      },
    })

    // WeChat Mini Program chunk listener
    ;(requestTask as any).onChunkReceived?.((res: { data: ArrayBuffer }) => {
      const text = analysisApi._arrayBufferToString(res.data)
      buffer += text

      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const part of parts) {
        if (!part.trim()) continue
        analysisApi._processSSEMessage(part, callbacks)
      }
    })

    return Promise.resolve(requestTask)
  },

  /**
   * 历史分析列表（keyword 按标题模糊搜索）
   */
  listAnalyses(
    page = 1,
    limit = DEFAULT_PAGE_SIZE,
    keyword?: string,
  ): Promise<PaginatedAnalyses> {
    const data: Record<string, any> = { page, limit }
    if (keyword) {
      data.keyword = keyword
    }
    return request({
      url: '/analysis/list',
      method: 'GET',
      data,
    })
  },

  /**
   * 分析详情（用于恢复历史记录）
   */
  getDetail(id: string): Promise<AnalysisDetail> {
    return request({
      url: `/analysis/${id}`,
      method: 'GET',
    })
  },

  /**
   * 删除分析记录（级联删除文件/图表/结果）
   */
  deleteAnalysis(id: string): Promise<{ success: boolean }> {
    return request({
      url: `/analysis/${id}`,
      method: 'DELETE',
    })
  },

  /**
   * 重命名分析标题
   */
  renameAnalysis(id: string, title: string): Promise<{ id: string }> {
    return request({
      url: `/analysis/${id}`,
      method: 'PATCH',
      data: { title },
    })
  },

  // ── Internal SSE helpers (same as chat.api.ts) ──────────────

  _processSSEMessage(raw: string, cb: AnalysisStreamCallbacks): void {
    let eventType = ''
    let data = ''

    const lines = raw.split('\n')
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        if (data) data += '\n'
        data += line.slice(6)
      }
    }

    switch (eventType) {
      case 'thinking':
        cb.onThinking?.(data)
        break
      // 规范化四事件：summary / insights / report / chart
      case 'summary':
        cb.onSummary?.(data)
        break
      case 'insights':
        try {
          const parsed = JSON.parse(data)
          cb.onInsights?.(parsed.items ?? [])
        } catch {
          // ignore
        }
        break
      case 'report':
        cb.onReport?.(data)
        break
      case 'chart':
        try {
          const parsed = JSON.parse(data)
          if (parsed.chart) cb.onChart?.(parsed.chart)
        } catch {
          // ignore
        }
        break
      case 'progress': {
        try {
          const parsed = JSON.parse(data)
          cb.onProgress?.(parsed.stage ?? '', parsed.percent ?? 0)
        } catch {
          // ignore
        }
        break
      }
      case 'complete':
        try {
          const result = JSON.parse(data) as AnalysisResult
          cb.onComplete?.(result)
        } catch {
          cb.onComplete?.({ summary: '', content: data, charts: [], tables: [], insights: [] })
        }
        break
      case 'error':
        cb.onError?.(data)
        break
    }
  },

  _processBuffer(raw: string, cb: AnalysisStreamCallbacks): void {
    analysisApi._processSSEMessage(raw, cb)
  },

  _arrayBufferToString(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let result = ''
    let i = 0
    while (i < bytes.length) {
      const byte = bytes[i++]
      if (byte < 0x80) {
        result += String.fromCharCode(byte)
      } else if (byte >= 0xc0 && byte < 0xe0) {
        const byte2 = bytes[i++]
        result += String.fromCharCode(((byte & 0x1f) << 6) | (byte2 & 0x3f))
      } else if (byte >= 0xe0 && byte < 0xf0) {
        const byte2 = bytes[i++]
        const byte3 = bytes[i++]
        result += String.fromCharCode(
          ((byte & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f),
        )
      } else if (byte >= 0xf0) {
        const byte2 = bytes[i++]
        const byte3 = bytes[i++]
        const byte4 = bytes[i++]
        const cp =
          ((byte & 0x07) << 18) |
          ((byte2 & 0x3f) << 12) |
          ((byte3 & 0x3f) << 6) |
          (byte4 & 0x3f)
        result += String.fromCharCode(
          0xd800 + ((cp - 0x10000) >> 10),
          0xdc00 + ((cp - 0x10000) & 0x3ff),
        )
      }
    }
    return result
  },
}
