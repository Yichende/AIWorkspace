import { View, Text } from '@tarojs/components'
import { AppHeader } from '@my/ui'
import Taro, { useRouter } from '@tarojs/taro'
import { useState, useEffect, useCallback } from 'react'
import { useAnalysisStore } from '@/stores/analysis.store'
import { useAnalysisStream } from '@/hooks/useAnalysisStream'
import AnalysisResult from '@/components/Analysis/AnalysisResult'
import { useSettingsStore } from '@/stores/settings.store'
import './detail.scss'

/**
 * 分析详情页。
 *
 * 非终态会话（PENDING / ANALYZING）现在会**附着到直播流**，而不是像以前那样
 * 显示「该记录没有可展示的分析结果 / 请返回列表重新发起分析」的死胡同 ——
 * 服务端一直在推，只是之前没人听。
 */
export default function AnalysisDetailPage() {
  const theme = useSettingsStore((s) => s.theme)
  const router = useRouter()
  const { id } = router.params

  const status = useAnalysisStore((s) => s.status)
  const result = useAnalysisStore((s) => s.result)
  const charts = useAnalysisStore((s) => s.charts)
  const tables = useAnalysisStore((s) => s.tables)
  const progressPercent = useAnalysisStore((s) => s.progressPercent)
  const errorMessage = useAnalysisStore((s) => s.errorMessage)
  const stopped = useAnalysisStore((s) => s.stopped)
  const streamTimeout = useAnalysisStore((s) => s.streamTimeout)
  const prefixTruncated = useAnalysisStore((s) => s.prefixTruncated)

  const { attachToSession, detachToSession } = useAnalysisStream()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    let cancelled = false
    attachToSession(id).finally(() => {
      if (!cancelled) setLoading(false)
    })

    // 收尾必须写在清理函数里：用户「进详情 → 返回」若不脱离，
    // 会留下一条仍在往同一个 store 写事件的流（旧页面污染新页面）。
    return () => {
      cancelled = true
      detachToSession()
    }
  }, [id, attachToSession, detachToSession])

  /** 超时后重连：保留游标（reset: false），只补增量 */
  const handleReconnect = useCallback(() => {
    if (!id) return
    setLoading(true)
    attachToSession(id, { reset: false }).finally(() => setLoading(false))
  }, [id, attachToSession])

  const hasResult = !!result

  const statusText = stopped
    ? '已停止分析'
    : status === 'FAILED'
      ? errorMessage || '分析失败'
      : streamTimeout
        ? '连接已断开，分析仍在后台进行'
        : status === 'PENDING'
          ? '等待执行'
          : '分析中'

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
          <>
            {prefixTruncated && (
              <View className='detail-page__empty'>
                <Text className='detail-page__empty-hint'>
                  注意：服务端只保留了分析的最近一段内容，正文前缀已丢失，本报告不完整。
                </Text>
              </View>
            )}
            <AnalysisResult charts={charts} tables={tables} result={result!} />
          </>
        ) : (
          <View className='detail-page__empty'>
            <Text className='detail-page__empty-text'>{statusText}</Text>
            {status !== 'FAILED' && !stopped && (
              <Text className='detail-page__empty-hint'>
                进度 {progressPercent}%
              </Text>
            )}
            {streamTimeout && (
              <Text
                className='detail-page__empty-hint'
                onClick={handleReconnect}
              >
                重新连接
              </Text>
            )}
            {stopped && (
              <Text className='detail-page__empty-hint'>
                分析已停止，可返回列表重新发起
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  )
}
