import { View, Text } from '@tarojs/components'
import MarkdownBlock from '@/components/Chat/Blocks/MarkdownBlock'
import type { AnalysisStatus, ChartConfig, TableConfig } from '@repo/types'
import './index.scss'

interface Props {
  status: AnalysisStatus | null
  progress: string[]
  streamingText: string
  charts: ChartConfig[]
  tables: TableConfig[]
}

export default function AnalysisProgress({
  status,
  progress,
  streamingText,
  charts,
  tables,
}: Props) {
  const isPending = status === 'PENDING'
  const isAnalyzing = status === 'ANALYZING'
  const isFailed = status === 'FAILED'

  return (
    <View className='progress-step'>
      <View className='progress-step__header'>
        <Text className='progress-step__title'>
          {isPending ? '等待执行...' : isAnalyzing ? '正在分析...' : isFailed ? '分析失败' : ''}
        </Text>
      </View>

      {/* 进度列表 */}
      <View className='progress-step__list'>
        {progress.map((msg, i) => {
          const isLatest = i === progress.length - 1
          const isDone = msg.startsWith('✓')
          const isError = msg.startsWith('❌')

          return (
            <View
              key={i}
              className={`progress-step__item ${isLatest ? 'latest' : ''} ${isError ? 'error' : ''}`}
            >
              <View className={`progress-step__dot ${isDone ? 'done' : isError ? 'error' : 'active'}`}>
                {isDone ? '✓' : isError ? '✕' : isLatest ? '' : '✓'}
              </View>
              <Text className='progress-step__msg'>{msg.replace(/^[✓❌]\s*/, '')}</Text>
            </View>
          )
        })}
      </View>

      {/* 流式累积文本 */}
      {streamingText && (
        <View className='progress-step__stream'>
          <MarkdownBlock content={streamingText} />
        </View>
      )}

      {/* 已生成的图表/表格计数 */}
      {(charts.length > 0 || tables.length > 0) && (
        <View className='progress-step__generated'>
          {charts.length > 0 && (
            <Text className='progress-step__gen-tag'>📊 {charts.length} 个图表已生成</Text>
          )}
          {tables.length > 0 && (
            <Text className='progress-step__gen-tag'>📋 {tables.length} 个表格已生成</Text>
          )}
        </View>
      )}
    </View>
  )
}
