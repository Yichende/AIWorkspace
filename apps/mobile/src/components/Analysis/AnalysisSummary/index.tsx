import { View, Text } from '@tarojs/components'
import './index.scss'

interface Props {
  summary: string
}

/** 分析摘要区块（结果页与流式进度页共用） */
export default function AnalysisSummary({ summary }: Props) {
  if (!summary || !summary.trim()) return null
  return (
    <View className='analysis-summary'>
      <Text className='analysis-summary__label'>分析摘要</Text>
      <Text className='analysis-summary__text'>{summary}</Text>
    </View>
  )
}
