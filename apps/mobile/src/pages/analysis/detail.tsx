import { View, Text } from '@tarojs/components'
import { AppHeader } from '@my/ui'
import Taro, { useRouter } from '@tarojs/taro'
import { useState, useEffect } from 'react'
import { analysisApi } from '@/services/analysis.api'
import AnalysisResult from '@/components/Analysis/AnalysisResult'
import type { AnalysisDetail } from '@repo/types'
import { useSettingsStore } from '@/stores/settings.store'
import './detail.scss'

/** 非 COMPLETED 会话的状态文案 */
const STATUS_LABEL: Record<string, string> = {
  PENDING: '等待执行',
  ANALYZING: '分析中',
  FAILED: '分析失败',
}

export default function AnalysisDetailPage() {
  const theme = useSettingsStore((s) => s.theme)
  const router = useRouter()
  const { id } = router.params
  const [detail, setDetail] = useState<AnalysisDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    analysisApi
      .getDetail(id)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  // 历史记录里存在失败/进行中的会话（result 为 null），不能白屏
  const hasResult = !!detail?.result

  return (
    <View className={`detail-page page-root theme-${theme}`}>
      <AppHeader
        title='分析结果'
        onBack={() => Taro.navigateBack({ delta: 1 })}
      />
      <View className='detail-page__body'>
        {loading ? (
          <View className='detail-page__empty'>
            <Text className='detail-page__empty-text'>加载中...</Text>
          </View>
        ) : hasResult ? (
          <AnalysisResult
            charts={detail!.charts}
            tables={detail!.tables}
            result={detail!.result!}
          />
        ) : (
          <View className='detail-page__empty'>
            <Text className='detail-page__empty-text'>
              {detail
                ? `${STATUS_LABEL[detail.session.status] ?? '暂无结果'}，该记录没有可展示的分析结果`
                : '分析记录不存在或已删除'}
            </Text>
            <Text className='detail-page__empty-hint'>
              请返回列表重新发起分析
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}