import { View, Text } from '@tarojs/components'
import type { ChartConfig, TableConfig, AnalysisResult } from '@repo/types'
import MarkdownBlock from '@/components/Chat/Blocks/MarkdownBlock'
import ChartRenderer from '../ChartRenderer'
import TableRenderer from '../TableRenderer'
import './index.scss'

interface Props {
  charts: ChartConfig[]
  tables: TableConfig[]
  result: AnalysisResult
}

export default function AnalysisResult({ charts, tables, result }: Props) {
  const hasContent = result.content && result.content.trim().length > 0

  return (
    <View className='result-step'>
      {/* 摘要 */}
      {result.summary && (
        <View className='result-step__summary'>
          <Text className='result-step__summary-label'>分析摘要</Text>
          <Text className='result-step__summary-text'>{result.summary}</Text>
        </View>
      )}

      {/* Insights */}
      {result.insights && result.insights.length > 0 && (
        <View className='result-step__insights'>
          <Text className='result-step__insights-label'>关键发现</Text>
          {result.insights.map((insight, i) => (
            <View key={i} className='result-step__insight-item'>
              <Text className='result-step__insight-num'>{i + 1}</Text>
              <Text className='result-step__insight-text'>{insight}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 图表 */}
      {charts.length > 0 && (
        <View className='result-step__charts'>
          <Text className='result-step__section-title'>📊 分析图表</Text>
          {charts.map((chart) => (
            <View key={chart.id} className='result-step__chart-wrap'>
              <ChartRenderer config={chart} />
            </View>
          ))}
        </View>
      )}

      {/* 表格 */}
      {tables.length > 0 && (
        <View className='result-step__tables'>
          <Text className='result-step__section-title'>📋 数据表格</Text>
          {tables.map((table) => (
            <View key={table.id} className='result-step__table-wrap'>
              <Text className='result-step__table-title'>{table.title}</Text>
              <TableRenderer config={table} />
            </View>
          ))}
        </View>
      )}

      {/* Markdown 正文 */}
      {hasContent && (
        <View className='result-step__content'>
          <Text className='result-step__section-title'>📝 分析报告</Text>
          <View className='result-step__markdown'>
            <MarkdownBlock content={result.content} />
          </View>
        </View>
      )}
    </View>
  )
}
