import { View, Text, ScrollView } from '@tarojs/components'
import { AppHeader } from '@my/ui'
import Taro from '@tarojs/taro'
import { useState, useEffect, useCallback } from 'react'
import { analysisApi } from '@/services/analysis.api'
import { useUserStore } from '@/stores/user.store'
import type { AnalysisListItem } from '@repo/types'
import './list.scss'

export default function AnalysisListPage() {
  const [items, setItems] = useState<AnalysisListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const authReady = useUserStore((state) => state.authReady)

  const fetchList = useCallback(async (p: number) => {
    try {
      setLoading(true)
      const res = await analysisApi.listAnalyses(p)
      if (p === 1) {
        setItems(res.items)
      } else {
        setItems((prev) => [...prev, ...res.items])
      }
      setHasMore(res.hasMore)
    } catch {
      // keep current items
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authReady) {
      fetchList(1)
    }
  }, [authReady, fetchList])

  const handleLoadMore = () => {
    if (loading || !hasMore) return
    const nextPage = page + 1
    setPage(nextPage)
    fetchList(nextPage)
  }

  const handleItemClick = (id: string) => {
    Taro.navigateTo({ url: `/pages/analysis/detail?id=${id}` })
  }

  const handleBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'PENDING': return '等待中'
      case 'ANALYZING': return '分析中'
      case 'COMPLETED': return '已完成'
      case 'FAILED': return '失败'
      default: return status
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return '#117C0D'
      case 'ANALYZING': return '#FAC75E'
      case 'FAILED': return '#E74C3C'
      default: return '#9B9B9B'
    }
  }

  return (
    <View className='list-page'>
      <AppHeader title='我的分析' onBack={handleBack} />

      <ScrollView
        scrollY
        className='list-page__scroll'
        onScrollToLower={handleLoadMore}
        lowerThreshold={100}
      >
        {items.length === 0 && !loading && (
          <View className='list-page__empty'>
            <Text className='list-page__empty-icon'>📊</Text>
            <Text className='list-page__empty-text'>暂无分析记录</Text>
          </View>
        )}

        {items.map((item) => (
          <View
            key={item.id}
            className='list-page__item'
            onClick={() => handleItemClick(item.id)}
          >
            <View className='list-page__item-left'>
              <Text className='list-page__item-title'>{item.title}</Text>
              <View className='list-page__item-meta'>
                {item.fileName && (
                  <Text className='list-page__item-file'>📄 {item.fileName}</Text>
                )}
                {item.chartCount > 0 && (
                  <Text className='list-page__item-charts'>📊 {item.chartCount} 个图表</Text>
                )}
                <Text className='list-page__item-date'>{item.createdAt}</Text>
              </View>
            </View>
            <View className='list-page__item-right'>
              <Text
                className='list-page__item-status'
                style={{ color: statusColor(item.status) }}
              >
                {statusLabel(item.status)}
              </Text>
            </View>
          </View>
        ))}

        {loading && (
          <View className='list-page__loading'>
            <View className='list-page__loading-dots'>
              <View className='list-page__dot' />
              <View className='list-page__dot' />
              <View className='list-page__dot' />
            </View>
          </View>
        )}

        {!hasMore && items.length > 0 && (
          <View className='list-page__end'>
            <Text>— 没有更多了 —</Text>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
