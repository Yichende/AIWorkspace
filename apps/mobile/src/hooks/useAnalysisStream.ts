import { useCallback } from 'react'
import { useAnalysisStore } from '@/stores/analysis.store'
import { analysisApi } from '@/services/analysis.api'
import type {
  ProgressStage,
  AnalysisResult as AnalysisResultType,
  AnalysisStatus,
} from '@repo/types'

/**
 * useAnalysisStream — SSE 事件分发 Hook
 *
 * 职责：
 * - 创建分析任务 (POST /analysis/create)
 * - 订阅 SSE 流 (GET /analysis/:id/stream)
 * - 服务端按规范化事件推送（summary / insights / report / chart / table），
 *   此处分发到 analysisStore
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
    setPrompt,
  } = useAnalysisStore()

  const startAnalysis = useCallback(
    async (fileId: string, userPrompt: string, model: string) => {
      setPrompt(userPrompt)
      setStatus('PENDING')

      try {
        // 1. 创建分析任务
        const { id } = await analysisApi.create({
          fileId,
          prompt: userPrompt,
          model,
        })
        setSessionId(id)
        setStatus('ANALYZING' as AnalysisStatus)

        // 2. 订阅 SSE 流（服务端已按事件分类推送）
        // 顺序门控状态：summary 未到时，insights/chart/table 先入队不显示
        let summaryShown = false
        const pending: Array<() => void> = []
        const flushPending = () => {
          while (pending.length > 0) {
            pending.shift()!()
          }
        }

        analysisApi.stream(id, {
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
            setFailed(err)
          },
        })
      } catch (err: any) {
        setFailed(err.message || '创建任务失败')
      }
    },
    [
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
      setPrompt,
    ],
  )

  return { startAnalysis }
}
