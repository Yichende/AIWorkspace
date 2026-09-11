import Taro from '@tarojs/taro'
import type {
  CreateAnalysisParams,
  CreateAnalysisResponse,
  UploadFileResponse,
  PaginatedAnalyses,
  AnalysisDetail,
  AnalysisResult,
  ChartConfig,
  TableConfig,
} from '@repo/types'
import { DEFAULT_PAGE_SIZE } from '@repo/constants'
import { SseFrameReader } from '@/utils/sse'
import type { SseFrame } from '@/utils/sse'
import { getValidAccessToken } from './token-refresh'
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
  /** 分析表格 */
  onTable?: (table: TableConfig) => void
  onProgress?: (stage: string, percent: number) => void
  onComplete?: (result: AnalysisResult) => void
  onError?: (err: string) => void
}

// ── API ────────────────────────────────────────────────────

export const analysisApi = {
  /**
   * 上传文件 → 服务端解析 → 返回 DatasetSummary
   * @param originalName 原始文件名：小程序 uploadFile 的 multipart filename 是
   * 临时路径 basename（内容哈希命名），真名需经 formData 显式携带，
   * 否则服务端落库/展示的都是哈希串。
   */
  async upload(
    filePath: string,
    fileName: string,
    originalName?: string,
  ): Promise<UploadFileResponse> {
    // 临期则先刷新（单飞，与其他请求共享同一次刷新）
    const token = await getValidAccessToken()

    return new Promise((resolve, reject) => {
      Taro.uploadFile({
        url: `${BASE_URL}/analysis/upload`,
        filePath,
        name: 'file',
        // 显式携带原始文件名（微信 multipart 的 filename 无法自定义）
        ...(originalName ? { formData: { originalName } } : {}),
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
    // 临期则先刷新（单飞，与其他请求共享同一次刷新）
    const token = await getValidAccessToken()

    // 共享收流骨架：增量 UTF-8 解码（跨 chunk 字节残留）+ \n\n 拆帧留尾 + 分发完整帧
    const reader = new SseFrameReader((frame) => {
      analysisApi._dispatchFrame(frame, callbacks)
    })

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

  // ── Internal helper ───────────────────────────────────────

  /** SSE 帧分发（业务事件表；JSON 事件容错解析）—— 解码/拆帧在 utils/sse.ts */
  _dispatchFrame(frame: SseFrame, cb: AnalysisStreamCallbacks): void {
    switch (frame.event) {
      case 'thinking':
        cb.onThinking?.(frame.data)
        break
      // 规范化四事件：summary / insights / report / chart
      case 'summary':
        cb.onSummary?.(frame.data)
        break
      case 'insights':
        try {
          const parsed = JSON.parse(frame.data)
          cb.onInsights?.(parsed.items ?? [])
        } catch {
          // ignore
        }
        break
      case 'report':
        cb.onReport?.(frame.data)
        break
      case 'chart':
        try {
          const parsed = JSON.parse(frame.data)
          if (parsed.chart) cb.onChart?.(parsed.chart)
        } catch {
          // ignore
        }
        break
      case 'table':
        try {
          const parsed = JSON.parse(frame.data)
          if (parsed.table) cb.onTable?.(parsed.table)
        } catch {
          // ignore
        }
        break
      case 'progress': {
        try {
          const parsed = JSON.parse(frame.data)
          cb.onProgress?.(parsed.stage ?? '', parsed.percent ?? 0)
        } catch {
          // ignore
        }
        break
      }
      case 'complete':
        try {
          const result = JSON.parse(frame.data) as AnalysisResult
          cb.onComplete?.(result)
        } catch {
          cb.onComplete?.({
            summary: '',
            content: frame.data,
            charts: [],
            tables: [],
            insights: [],
          })
        }
        break
      case 'error':
        cb.onError?.(frame.data)
        break
    }
  },
}
