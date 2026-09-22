import Taro from '@tarojs/taro'
import type {
  CreateAnalysisParams,
  CreateAnalysisResponse,
  UploadFileResponse,
  PaginatedAnalyses,
  AnalysisDetail,
  AnalysisCompletePayload,
  AnalysisResult,
  ChartConfig,
  TableConfig,
} from '@repo/types'
import { DEFAULT_PAGE_SIZE } from '@repo/constants'
import type { SseFrame } from '@/utils/sse'
import { createSSEClient } from '@/utils/sse-client'
import { ERROR_COPY, ErrorKind, toApiError } from '@/utils/api-error'
import { uploadWithAuth } from '@/utils/upload'
import { API_BASE_URL as BASE_URL } from '@/config/env'
import request from './request'

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
  /** 事件序号（SSE `id:` 行），调用方据此维护重连游标 */
  onSeq?: (seq: number) => void
  /** 服务端缓冲已越界：正文前缀永久丢失，参数是仍可续传的起点 */
  onTruncated?: (firstSeq: number) => void
  /** 传输层超时：连接被服务端收尾，但分析仍在后台跑 —— **不是失败** */
  onTimeout?: (message: string) => void
  /** 服务端正常收尾（终态帧已经发过了） */
  onDone?: () => void
  /** 同步交付 RequestTask 句柄 —— 供调用方 abort() 停止分析 */
  onTaskReady?: (task: Taro.RequestTask<any>) => void
}

/**
 * 把线上 `complete` 帧的裸负载归一为 AnalysisResult。
 *
 * 服务端历史上可能在缺结果时下发 `{}`，且客户端此前是盲 cast，
 * 逐字段兜底可保证 `result.summary` 之类的读取不会拿到 undefined。
 */
function normalizeAnalysisResult(raw: any): AnalysisResult {
  return {
    summary: typeof raw?.summary === 'string' ? raw.summary : '',
    content: typeof raw?.content === 'string' ? raw.content : '',
    charts: Array.isArray(raw?.charts) ? raw.charts : [],
    tables: Array.isArray(raw?.tables) ? raw.tables : [],
    insights: Array.isArray(raw?.insights) ? raw.insights : [],
  }
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
    originalName?: string,
  ): Promise<UploadFileResponse> {
    return uploadWithAuth<UploadFileResponse>({
      url: `${BASE_URL}/analysis/upload`,
      filePath,
      name: 'file',
      // 显式携带原始文件名（微信 multipart 的 filename 无法自定义）
      ...(originalName ? { formData: { originalName } } : {}),
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
   * 事件类型：thinking / summary / insights / report / chart / table /
   * progress / complete / error / truncated / timeout / done
   *
   * @param after 游标：>0 时只回放该序号之后的事件。附着到一个已经在跑的
   *   会话时必须带上，否则会把已产出的正文**再追加一遍**（append 语义）。
   */
  async stream(
    id: string,
    callbacks: AnalysisStreamCallbacks,
    after = 0,
  ): Promise<void> {
    // 请求构造/收流骨架在 utils/sse-client.ts（与 chat.api 共用）
    const query = after > 0 ? `?after=${after}` : ''
    return createSSEClient(
      { url: `${BASE_URL}/analysis/${id}/stream${query}`, method: 'GET' },
      {
        onFrame: (frame) => analysisApi._dispatchFrame(frame, callbacks),
        onError: (err) =>
          callbacks.onError?.(toApiError(err, ERROR_COPY[ErrorKind.Stream]).message),
        onTaskReady: callbacks.onTaskReady,
      },
    )
  },

  /**
   * 取消正在跑的分析。
   *
   * 只 abort 本地 SSE 是不够的：阶段一之后断开只代表「少了一个听众」，
   * 运行会在 worker 里继续跑到 COMPLETED。必须显式调这个接口。
   */
  cancel(id: string): Promise<{ success: boolean; message?: string }> {
    return request({
      url: `/analysis/${id}/cancel`,
      method: 'POST',
    })
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
    // 游标先于业务事件处理：任何带 id: 的帧都要把序号记下来，
    // 重连时回传 ?after=，否则会重复收已产出的正文
    if (frame.id) {
      const seq = Number.parseInt(frame.id, 10)
      if (Number.isFinite(seq)) cb.onSeq?.(seq)
    }

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
          // 线上 complete 帧的 data 是裸 AnalysisResult（无 payload 包裹）
          const payload = JSON.parse(frame.data) as AnalysisCompletePayload
          cb.onComplete?.(normalizeAnalysisResult(payload))
        } catch {
          // 解析不出来就是真失败，不能把裸 JSON 当正文塞进结果页
          cb.onError?.('分析结果解析失败')
        }
        break
      case 'error':
        // 线上仍是裸字符串（不改服务端格式），这里只归一化出 message
        cb.onError?.(toApiError(frame.data, ERROR_COPY[ErrorKind.Stream]).message)
        break
      // 服务端缓冲越界：正文前缀没了，客户端先清缓冲再接着收
      case 'truncated': {
        let firstSeq = 1
        try {
          const parsed = JSON.parse(frame.data)
          if (typeof parsed?.firstSeq === 'number') firstSeq = parsed.firstSeq
        } catch {
          // 解析不出来就按「从头都不可信」处理
        }
        cb.onTruncated?.(firstSeq)
        break
      }
      // 传输层超时：连接被收尾，但分析仍在后台跑 —— 绝不能当失败处理
      case 'timeout': {
        let message = '连接超时，分析仍在后台进行'
        try {
          const parsed = JSON.parse(frame.data)
          if (typeof parsed?.message === 'string') message = parsed.message
        } catch {
          // 用兜底文案
        }
        cb.onTimeout?.(message)
        break
      }
      case 'done':
        cb.onDone?.()
        break
    }
  },
}
