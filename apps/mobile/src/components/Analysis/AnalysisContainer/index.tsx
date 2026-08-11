import { View } from '@tarojs/components'
import { useAnalysisStore } from '@/stores/analysis.store'
import { useAnalysisStream } from '@/hooks/useAnalysisStream'
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
    result,
    charts,
    tables,
    thinkingText,
    progressStage,
    progressPercent,
    streamingText,
    status,
    fileId,
    setModel,
  } = useAnalysisStore()

  const { startAnalysis } = useAnalysisStream()

  // ── Upload → Preview ───────────────────────────────────────

  const handleUploaded = (fileInfo, fid, ds) => {
    setFile(fileInfo, fid, ds)
  }

  // ── Preview → Prompt ───────────────────────────────────────

  const handleContinueToPrompt = () => {
    setStep('prompt')
  }

  // ── Prompt → Analyzing（委托给 useAnalysisStream hook）─────

  const handleStartAnalysis = async (userPrompt: string) => {
    if (!fileId) return
    setStep('analyzing')
    startAnalysis(fileId, userPrompt, model)
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
          thinkingText={thinkingText}
          streamingText={streamingText}
          progressStage={progressStage}
          progressPercent={progressPercent}
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
