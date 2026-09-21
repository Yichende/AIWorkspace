import { useCallback } from 'react'
import Taro from '@tarojs/taro'
import { useAnalysisStore } from '@/stores/analysis.store'
import { analysisApi } from '@/services/analysis.api'
import type { AnalysisStreamCallbacks } from '@/services/analysis.api'
import type {
  ProgressStage,
  AnalysisResult as AnalysisResultType,
  AnalysisStatus,
} from '@repo/types'

// ── Active stream tracking ───────────────────────────────────
//
// 与 chat.controller 的 activeStream 同构：放模块级而非组件内 ref，
// 使退出登录等跨页面场景也能中断进行中的分析 SSE。

interface ActiveAnalysisStream {
  task?: Taro.RequestTask<any>
  /** 用户主动停止标记 —— 与真实错误区分（决定「已停止」还是「分析失败」文案） */
  stopRequested: boolean
}

let activeAnalysisStream: ActiveAnalysisStream | null = null

/**
 * 中断当前分析流（停止按钮与退出登录共用）。
 *
 * 客户端 abort 后服务端会经 `req.on('close')` 中止上游请求；
 * 会话保持 ANALYZING，不落 FAILED（见 analysis-queue.service.execute）。
 */
export function stopActiveAnalysisStream(): void {
  if (!activeAnalysisStream) return
  activeAnalysisStream.stopRequested = true
  activeAnalysisStream.task?.abort()
  activeAnalysisStream = null
}

/**
 * useAnalysisStream — SSE 事件分发 Hook
 *
 * 职责：
 * - 创建分析任务 (POST /analysis/create)
 * - 订阅 SSE 流 (GET /analysis/:id/stream)
 * - 服务端按规范化事件推送（summary / insights / report / chart / table），
 *   此处分发到 analysisStore
 * - 支持停止与重试
 *
 * 事件顺序门控：模型输出顺序不稳定，summary 未到达时 insights/chart/table
 * 先入 pending 队列不显示；收到 summary 后逐个释放（summary → insights →
 * chart → table 按序出现）。report 正文不设门控，保持流式体验。
 *
 * Container 只需调用 startAnalysis()，读取 store 渲染 UI。
 */
export function useAnalysisStream() {
  const {
    setSessionId,
    setStatus,
    appendThinking,
    appendStreamingText,
    setStreamingSummary,
    setStreamingInsights,
    addChart,
    addTable,
    setProgress,
    setComplete,
    setFailed,
    setStopped,
    setPrompt,
    resetStreamingState,
  } = useAnalysisStore()

  /**
   * 订阅某个会话的 SSE 流。
   *
   * 事件顺序门控状态在每次调用内新建（重试即重新开始门控）。
   */
  const runStream = useCallback(
    async (
      sessionId: string,
      ctl: ActiveAnalysisStream,
    ): Promise<void> => {
      let summaryShown = false
      const pending: Array<() => void> = []
      const flushPending = () => {
        while (pending.length > 0) {
          pending.shift()!()
        }
      }

      const callbacks: AnalysisStreamCallbacks = {
        onThinking: (delta: string) => {
          // 思考内容直接追加
          appendThinking(delta)
        },

        onSummary: (delta: string) => {
          summaryShown = true
          setStreamingSummary(delta)
          // summary 到达后逐个释放排队事件（insights → chart → table）
          flushPending()
        },

        onInsights: (items: string[]) => {
          if (summaryShown) setStreamingInsights(items)
          else pending.push(() => setStreamingInsights(items))
        },

        onReport: (delta: string) => {
          // 正文不设门控，保持流式
          appendStreamingText(delta)
        },

        onChart: (chart) => {
          if (summaryShown) addChart(chart)
          else pending.push(() => addChart(chart))
        },

        onTable: (table) => {
          if (summaryShown) addTable(table)
          else pending.push(() => addTable(table))
        },

        onProgress: (stage: string, percent: number) => {
          setProgress(stage as ProgressStage, percent)
        },

        onComplete: (result: AnalysisResultType) => {
          // summary 从未出现时也不阻塞到底，统一释放排队事件
          flushPending()
          setComplete(result)
        },

        onError: (err: string) => {
          if (ctl.stopRequested) setStopped()
          else setFailed(err)
        },

        onTaskReady: (task) => {
          ctl.task = task
          // 用户在 task 建立前就点了停止（stream 里有 await 取 token）→ 立即中止
          if (ctl.stopRequested) task.abort()
        },
      }

      await analysisApi.stream(sessionId, callbacks)

      // 流 promise 只在请求结束时 settle。正常结束时 store 已是 COMPLETED/FAILED；
      // 仍停在中间态说明是静默断连（fail 回调没有给出错误），必须给出出口。
      const after = useAnalysisStore.getState()
      if (after.status !== 'COMPLETED' && after.status !== 'FAILED') {
        if (ctl.stopRequested) setStopped()
        else setFailed('连接中断，请重试')
      }
    },
    [
      appendThinking,
      setStreamingSummary,
      setStreamingInsights,
      appendStreamingText,
      addChart,
      addTable,
      setProgress,
      setComplete,
      setFailed,
      setStopped,
    ],
  )

  const startAnalysis = useCallback(
    async (fileId: string, userPrompt: string, model: string) => {
      setPrompt(userPrompt)
      setStatus('PENDING')

      const ctl: ActiveAnalysisStream = { stopRequested: false }
      activeAnalysisStream = ctl

      try {
        // 1. 创建分析任务
        const { id } = await analysisApi.create({
          fileId,
          prompt: userPrompt,
          model,
        })
        if (ctl.stopRequested) return

        setSessionId(id)
        setStatus('ANALYZING' as AnalysisStatus)

        // 2. 订阅 SSE 流
        await runStream(id, ctl)
      } catch (err: any) {
        if (ctl.stopRequested) setStopped()
        else setFailed(err.message || '创建任务失败')
      } finally {
        if (activeAnalysisStream === ctl) activeAnalysisStream = null
      }
    },
    [runStream, setPrompt, setStatus, setSessionId, setFailed, setStopped],
  )

  /** 停止当前分析（立即置 UI 状态，abort 可能不产生任何回调） */
  const stopAnalysis = useCallback((): void => {
    setStopped()
    stopActiveAnalysisStream()
  }, [setStopped])

  /**
   * 重试：旧会话保持 FAILED，用同一份 fileId/prompt/model 创建一个**新**会话重新分析。
   *
   * 不复用旧会话重跑：服务端只对非终态会话执行管道，FAILED 会话重连只会重放 error。
   */
  const retryAnalysis = useCallback(async (): Promise<void> => {
    const { fileId, prompt, model } = useAnalysisStore.getState()
    if (!fileId || !prompt) return

    resetStreamingState()
    await startAnalysis(fileId, prompt, model)
  }, [resetStreamingState, startAnalysis])

  return { startAnalysis, stopAnalysis, retryAnalysis }
}
