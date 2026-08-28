import { View, Text } from '@tarojs/components'
import './index.scss'

interface Props {
  insights: string[]
}

/** 关键发现区块（结果页与流式进度页共用） */
export default function AnalysisInsights({ insights }: Props) {
  if (!insights || insights.length === 0) return null
  return (
    <View className='analysis-insights'>
      <Text className='analysis-insights__label'>关键发现</Text>
      {insights.map((insight, i) => (
        <View key={i} className='analysis-insights__item'>
          <Text className='analysis-insights__num'>{i + 1}</Text>
          <Text className='analysis-insights__text'>{insight}</Text>
        </View>
      ))}
    </View>
  )
}
