import { View, Text } from '@tarojs/components'
import { memo } from 'react'
import type { ChartConfig } from '@repo/types'
import ChartRenderer from '../ChartRenderer'
import './index.scss'

interface Props {
  charts: ChartConfig[]
}

/**
 * 单个图表块（memo）：流式文本高频更新（100ms throttle）时，
 * store 中已生成图表对象引用不变，memo 保证不触发重渲染。
 */
const ChartBlock = memo(function ChartBlock({
  config,
}: {
  config: ChartConfig
}) {
  return <ChartRenderer config={config} />
})

/** 图表区块（结果页与流式进度页共用） */
export default function AnalysisCharts({ charts }: Props) {
  if (!charts || charts.length === 0) return null
  return (
    <View className='analysis-charts'>
      <Text className='analysis-charts__title'>📊 分析图表</Text>
      {charts.map((chart) => (
        <View key={chart.id} className='analysis-charts__wrap'>
          <ChartBlock config={chart} />
        </View>
      ))}
    </View>
  )
}
