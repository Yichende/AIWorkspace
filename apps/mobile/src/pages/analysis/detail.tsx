import { View } from '@tarojs/components'
import { AppHeader } from '@my/ui'
import Taro, { useRouter } from '@tarojs/taro'
import { useState, useEffect } from 'react'
import { analysisApi } from '@/services/analysis.api'
import AnalysisResult from '@/components/Analysis/AnalysisResult'
import type { AnalysisDetail } from '@repo/types'
import './detail.scss'

export default function AnalysisDetailPage() {
  const router = useRouter()
  const { id } = router.params
  const [detail, setDetail] = useState<AnalysisDetail | null>(null)

  useEffect(() => {
    if (id) {
      analysisApi.getDetail(id).then(setDetail).catch(console.error)
    }
  }, [id])

  if (!detail?.result) return null

  return (
    <View className='detail-page'>
      <AppHeader
        title='分析结果'
        onBack={() => Taro.navigateBack({ delta: 1 })}
      />
      <View className='detail-page__body'>
        <AnalysisResult
          charts={detail.charts}
          tables={detail.tables}
          result={detail.result}
        />
      </View>
    </View>
  )
}