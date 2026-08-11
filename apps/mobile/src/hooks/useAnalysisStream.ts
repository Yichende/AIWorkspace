import { useCallback } from 'react'
import { JsonlStreamParser } from '@repo/analysis-parser'
import { useAnalysisStore } from '@/stores/analysis.store'
import { analysisApi } from '@/services/analysis.api'
import type {
  ProgressStage,
  AnalysisResult as AnalysisResultType,
  AnalysisStatus,
} from '@repo/types'

/**
 * useAnalysisStream — SSE + Parser + Store 编排 Hook
 *
 * 职责：
 * - 创建分析任务 (POST /analysis/create)
 * - 订阅 SSE 流 (GET /analysis/:id/stream)
 * - 客户端 JsonlStreamParser 解析原始 JSONL → text/chart/table
 * - 分发到 analysisStore
 *
 * Container 只需调用 startAnalysis()，读取 store 渲染 UI。
 */
export function useAnalysisStream() {
  const {
    setSessionId,
    setStatus,
    appendThinking,
    appendText,
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

        // 2. 客户端 JSONL 解析器（从共享包引入）
        const jsonlParser = new JsonlStreamParser()

        // 3. 订阅 SSE 流
        analysisApi.stream(id, {
          onThinking: (delta: string) => {
            // 思考内容直接追加
            appendThinking(delta)
          },

          onAnalysisDelta: (rawDelta: string) => {
            // 原始 JSONL 文本 → 解析 → 分发到 store
            const events = jsonlParser.feed(rawDelta)
            for (const event of events) {
              switch (event.type) {
                case 'text':
                  appendText(event.content)
                  break
                case 'chart':
                  addChart(event.payload)
                  break
                case 'table':
                  addTable(event.payload)
                  break
              }
            }
          },

          onProgress: (stage: string, percent: number) => {
            setProgress(stage as ProgressStage, percent)
          },

          onComplete: (result: AnalysisResultType) => {
            // Flush parser 残余
            const remaining = jsonlParser.flush()
            for (const event of remaining) {
              switch (event.type) {
                case 'text':
                  appendText(event.content)
                  break
                case 'chart':
                  addChart(event.payload)
                  break
                case 'table':
                  addTable(event.payload)
                  break
              }
            }
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
      appendText,
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
