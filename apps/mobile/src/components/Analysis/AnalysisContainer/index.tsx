import { View } from '@tarojs/components'
import { useAnalysisStore } from '@/stores/analysis.store'
import { analysisApi } from '@/services/analysis.api'
import type {
  ChartConfig,
  TableConfig,
  AnalysisResult as AnalysisResultType,
  AnalysisStatus,
} from '@repo/types'
import AnalysisUpload from '../AnalysisUpload'
import AnalysisPreview from '../AnalysisPreview'
import AnalysisPrompt from '../AnalysisPrompt'
import AnalysisProgress from '../AnalysisProgress'
import AnalysisResult from '../AnalysisResult'
import './index.scss'

/**
 * AnalysisContainer — 状态协调层
 *
 * 职责：
 * - 读取 analysisStore 的状态
 * - 根据 step 渲染对应子组件
 * - 处理流程转换（上传成功 → 预览 → 输入 prompt → 创建任务 → SSE → 结果）
 *
 * 子组件只通过 props 接收数据，通过 callbacks 通知事件，不直接操作 store。
 */
export default function AnalysisContainer() {
  const {
    step,
    setStep,
    file,
    dataset,
    model,
    setFile,
    setPrompt,
    setSessionId,
    addProgress,
    appendText,
    addChart,
    addTable,
    setComplete,
    setFailed,
    setStatus,
    result,
    charts,
    tables,
    progress,
    streamingText,
    status,
    fileId,
    setModel,
  } = useAnalysisStore()

  // ── Upload → Preview ───────────────────────────────────────

  const handleUploaded = (fileInfo, fid, ds) => {
    setFile(fileInfo, fid, ds)
  }

  // ── Preview → Prompt ───────────────────────────────────────

  const handleContinueToPrompt = () => {
    setStep('prompt')
  }

  // ── Prompt → Analyzing (create + SSE subscribe) ─────────────

  const handleStartAnalysis = async (userPrompt: string) => {
    if (!fileId) return

    setPrompt(userPrompt)
    setStep('analyzing')
    setStatus('PENDING')
    addProgress('正在创建分析任务...')

    try {
      // 1. 创建分析任务
      const { id } = await analysisApi.create({
        fileId,
        prompt: userPrompt,
        model,
      })
      setSessionId(id)
      addProgress('✓ 任务已创建，等待执行...')

      // 2. 订阅 SSE 流
      analysisApi.stream(id, {
        onStatus: (msg) => {
          // 提取纯文本消息
          const cleanMsg = msg.replace(/^[✓]\s*/, '✓ ').trim()
          if (!cleanMsg.startsWith('✓')) {
            setStatus('ANALYZING' as AnalysisStatus)
          }
          addProgress(cleanMsg.startsWith('✓') ? cleanMsg : `✓ ${cleanMsg}`)
        },

        onText: (delta) => {
          appendText(delta)
        },

        onChart: (chart: ChartConfig) => {
          addChart(chart)
        },

        onTable: (table: TableConfig) => {
          addTable(table)
        },

        onComplete: (res: AnalysisResultType) => {
          setComplete(res)
        },

        onError: (err: string) => {
          setFailed(err)
        },
      })
    } catch (err: any) {
      setFailed(err.message || '创建任务失败')
    }
  }

  // ── Render by Step ──────────────────────────────────────────

  return (
    <View className='analysis-container'>
      {step === 'upload' && (
        <AnalysisUpload onUploaded={handleUploaded} />
      )}

      {step === 'preview' && file && dataset && (
        <AnalysisPreview
          file={file}
          dataset={dataset}
          onContinue={handleContinueToPrompt}
          onBack={() => setStep('upload')}
        />
      )}

      {step === 'prompt' && dataset && (
        <AnalysisPrompt
          dataset={dataset}
          model={model}
          onModelChange={setModel}
          onSubmit={handleStartAnalysis}
          onBack={() => setStep('preview')}
        />
      )}

      {step === 'analyzing' && (
        <AnalysisProgress
          status={status}
          progress={progress}
          streamingText={streamingText}
          charts={charts}
          tables={tables}
        />
      )}

      {step === 'result' && result && (
        <AnalysisResult
          charts={charts}
          tables={tables}
          result={result}
        />
      )}
    </View>
  )
}
