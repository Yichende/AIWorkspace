import { View, Text } from '@tarojs/components'
import type { ChartConfig, TableConfig, AnalysisResult } from '@repo/types'
import MarkdownBlock from '@/components/Chat/Blocks/MarkdownBlock'
import AnalysisSummary from '../AnalysisSummary'
import AnalysisInsights from '../AnalysisInsights'
import AnalysisCharts from '../AnalysisCharts'
import AnalysisTables from '../AnalysisTables'
import './index.scss'

interface Props {
  charts: ChartConfig[]
  tables: TableConfig[]
  result: AnalysisResult
}

/** 结果页：组合共享区块组件（与流式进度页复用同一套区块） */
export default function AnalysisResult({ charts, tables, result }: Props) {
  const hasContent = result.content && result.content.trim().length > 0

  return (
    <View className='result-step'>
      {/* 摘要 / 关键发现 / 图表 / 表格：共享区块组件 */}
      <AnalysisSummary summary={result.summary} />
      <AnalysisInsights insights={result.insights} />
      <AnalysisCharts charts={charts} />
      <AnalysisTables tables={tables} />

      {/* Markdown 正文 */}
      {hasContent && (
        <View className='result-step__content'>
          <Text className='result-step__section-title'>分析报告</Text>
          <View className='result-step__markdown'>
            <MarkdownBlock content={result.content} />
          </View>
        </View>
      )}
    </View>
  )
}
