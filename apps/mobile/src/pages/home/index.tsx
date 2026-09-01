import { View, Text, Image } from '@tarojs/components'
import { AppHeader, Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useState } from 'react'
import { analysisApi } from '@/services/analysis.api'
import { useUserStore } from '@/stores/user.store'
import type { AnalysisListItem } from '@repo/types'
import { useSettingsStore } from '@/stores/settings.store'
import './index.scss'

/** 数据标题可能含换行符（小程序 text 组件会把 \n 渲染成换行），折叠为单行 */
const normalizeTitle = (title: string) => title.replace(/\s+/g, ' ')

const statusLabel = (status: string) => {
  switch (status) {
    case 'PENDING':
      return '等待中'
    case 'ANALYZING':
      return '分析中'
    case 'COMPLETED':
      return '已完成'
    case 'FAILED':
      return '失败'
    default:
      return status
  }
}

const statusColor = (status: string) => {
  switch (status) {
    case 'COMPLETED':
      return '#117C0D'
    case 'ANALYZING':
      return '#FAC75E'
    case 'FAILED':
      return '#E74C3C'
    default:
      return '#9B9B9B'
  }
}

/** 服务端返回 ISO 时间串，格式化为本地 YYYY-MM-DD HH:mm */
const formatTime = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function HomePage() {
  const theme = useSettingsStore((s) => s.theme)
  const authReady = useUserStore((state) => state.authReady)
  const [recentItems, setRecentItems] = useState<AnalysisListItem[]>([])
  const [recentLoading, setRecentLoading] = useState(false)

  // 最近三条分析：挂载时 + 每次回到首页时刷新
  const fetchRecentAnalyses = useCallback(async () => {
    try {
      setRecentLoading(true)
      const res = await analysisApi.listAnalyses(1, 3)
      setRecentItems(res.items)
    } catch {
      // 保留上次数据
    } finally {
      setRecentLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authReady) {
      fetchRecentAnalyses()
    }
  }, [authReady, fetchRecentAnalyses])

  useDidShow(() => {
    if (authReady) {
      fetchRecentAnalyses()
    }
  })

  const go2User = () => {
    Taro.navigateTo({
      url: '/pages/user/index',
    })
  }

  const gotoChat = () => {
    Taro.navigateTo({
      url: '/pages/chat/index',
    })
  }

  const gotoAnalysis = () => {
    Taro.navigateTo({
      url: '/pages/analysis/index',
    })
  }

  const gotoMyAnalyses = () => {
    Taro.navigateTo({
      url: '/pages/analysis/list',
    })
  }

  const gotoAnalysisDetail = (id: string) => {
    Taro.navigateTo({
      url: `/pages/analysis/detail?id=${id}`,
    })
  }

  return (
    <View className={`home-page page-root theme-${theme}`}>
      <AppHeader
        title='知数'
        showBack={false}
        leftActions={
          <View className='home-page__user-btn' onClick={go2User}>
            <Icon name='wode' size={46} color={IconColors.secondary} />
          </View>
        }
      />

      {/* 装饰图区域 */}
      <View className='decorate-area'>
        <Image
          className='decorate-image'
          src='/images/decorateImage.png'
          mode='aspectFill'
        />
      </View>

      {/* 功能区 - 左右两张卡片 */}
      <View className='feature-section'>
        {/* 智能对话卡片 */}
        <View className='feature-card' onClick={gotoChat}>
          <View className='card-row'>
            <Icon
              className='card-icon'
              name='xiaoxi'
              size={52}
              color={IconColors.secondary}
            />
            <View className='card-text'>
              <Text className='card-title'>智能对话</Text>
              <Text className='card-subtitle'>多模型自由问答</Text>
            </View>
          </View>
        </View>

        {/* 表格分析卡片 */}
        <View className='feature-card' onClick={gotoAnalysis}>
          <View className='card-row'>
            <Icon
              className='card-icon'
              name='shujufenxi'
              size={52}
              color={IconColors.secondary}
            />
            <View className='card-text'>
              <Text className='card-title'>表格分析</Text>
              <Text className='card-subtitle'>导入表格，自动生成图表</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 报告入口（同样左侧图标+右侧文字） */}
      <View className='report-entry' onClick={gotoMyAnalyses}>
        <View className='card-row'>
          <Icon name='baobiaochaxun' size={52} color={IconColors.secondary} />
          <View className='card-text'>
            <Text className='card-title'>我的分析报告</Text>
            <Text className='card-subtitle'>查看与整理历史分析</Text>
          </View>
        </View>
        <Icon name='qianjin' size={28} color={IconColors.secondary} />
      </View>
      {/* 最近分析 - 最近三条分析入口 */}
      <View className='recent-section'>
        <View className='recent-header'>
          <Text className='recent-title'>最近分析</Text>
        </View>

        {recentLoading ? (
          <View className='recent-loading'>
            <Text className='recent-loading-text'>加载中…</Text>
          </View>
        ) : recentItems.length === 0 ? (
          <View className='recent-empty' onClick={gotoAnalysis}>
            <Text className='recent-empty-text'>暂无分析记录，去创建</Text>
          </View>
        ) : (
          <View className='recent-list'>
            {recentItems.map((item) => (
              <View
                key={item.id}
                className='recent-item'
                onClick={() => gotoAnalysisDetail(item.id)}
              >
                <View className='recent-item-main'>
                  <Text className='recent-item-title'>
                    {normalizeTitle(item.title)}
                  </Text>
                  <Text className='recent-item-date'>
                    {formatTime(item.createdAt)}
                  </Text>
                </View>
                <Text
                  className='recent-item-status'
                  style={{ color: statusColor(item.status) }}
                >
                  {statusLabel(item.status)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  )
}
