import { useCallback } from 'react'
import { useAnalysisStore } from '@/stores/analysis.store'
import { analysisApi } from '@/services/analysis.api'
import type {
  ProgressStage,
  AnalysisResult as AnalysisResultType,
  AnalysisStatus,
} from '@repo/types'

/**
 * useAnalysisStream — SSE 四事件分发 Hook
 *
 * 职责：
 * - 创建分析任务 (POST /analysis/create)
 * - 订阅 SSE 流 (GET /analysis/:id/stream)
 * - 服务端按规范化四事件推送（summary / insights / report / chart），
 *   此处直接分发到 analysisStore
 *
 * Container 只需调用 startAnalysis()，读取 store 渲染 UI。
 */
export function useAnalysisStream() {
  const {
    setSessionId,
    setStatus,
    appendThinking,
    appendReport,
    appendSummary,
    addInsights,
    addChart,
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

        // 2. 订阅 SSE 流（服务端已按四事件分类推送）
        analysisApi.stream(id, {
          onThinking: (delta: string) => {
            // 思考内容直接追加
            appendThinking(delta)
          },

          onSummary: (delta: string) => {
            appendSummary(delta)
          },

          onInsights: (items: string[]) => {
            addInsights(items)
          },

          onReport: (delta: string) => {
            appendReport(delta)
          },

          onChart: (chart) => {
            addChart(chart)
          },

          onProgress: (stage: string, percent: number) => {
            setProgress(stage as ProgressStage, percent)
          },

          onComplete: (result: AnalysisResultType) => {
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
      appendReport,
      appendSummary,
      addInsights,
      addChart,
      setProgress,
      setComplete,
      setFailed,
      setPrompt,
    ],
  )

  return { startAnalysis }
}
