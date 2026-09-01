import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import SearchScreen from '@/components/common/SearchScreen'
import { chatApi } from '@/services/chat.api'
import { analysisApi } from '@/services/analysis.api'
import { DEFAULT_PAGE_SIZE } from '@repo/constants'
import type { SessionIndexItem, AnalysisListItem } from '@repo/types'

type SearchType = 'chat' | 'analysis'

/** 读取路由 type 参数，默认 chat 模式 */
function getSearchType(): SearchType {
  const params = Taro.getCurrentInstance().router?.params
  return params?.type === 'analysis' ? 'analysis' : 'chat'
}

/** 旧数据标题可能含换行符（小程序 text 组件会把 \n 渲染成换行），折叠为单行 */
const normalizeTitle = (title: string) => title.replace(/\s+/g, ' ')

/** 格式化时间：兼容时间戳（会话）与 ISO 字符串（分析） */
const formatTime = (value: number | string) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 分析状态展示（与"我的分析"列表页一致） */
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
    case 'COMPLETED': return 'var(--color-secondary)'
    case 'ANALYZING': return 'var(--color-accent)'
    case 'FAILED': return '#E74C3C'
    default: return 'var(--text-placeholder)'
  }
}

export default function SearchPage() {
  const type = getSearchType()
  const handleBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  // ── 对话历史模式：搜会话标题，点进 chat 页对应会话 ──

  if (type === 'chat') {
    return (
      <SearchScreen<SessionIndexItem>
        placeholder='搜索对话历史...'
        hintText='输入关键词搜索对话历史'
        itemKey={(s) => s.id}
        search={async (keyword, page) => {
          const res = await chatApi.listSessions(page, DEFAULT_PAGE_SIZE, keyword)
          // 会话列表接口无 hasMore 字段，按分页数量推断（与 chat 列表加载一致）
          const hasMore = res.items.length > 0 && page * DEFAULT_PAGE_SIZE < res.total
          return { items: res.items, hasMore }
        }}
        renderItem={(item) => (
          <>
            <View className='search-item-main'>
              <Text className='search-item-title'>{item.title}</Text>
              <View className='search-item-meta'>
                <Text>{item.model}</Text>
                <Text>{formatTime(item.updatedAt)}</Text>
              </View>
            </View>
            <Icon name='qianjin' size={28} color={IconColors.secondary} />
          </>
        )}
        onItemClick={(item) => {
          const title = encodeURIComponent(item.title)
          const model = encodeURIComponent(item.model)
          Taro.navigateTo({
            url: `/pages/chat/index?sessionId=${item.id}&title=${title}&model=${model}`,
          })
        }}
        onBack={handleBack}
      />
    )
  }

  // ── 分析结果模式：搜分析标题，点进分析详情页 ──

  return (
    <SearchScreen<AnalysisListItem>
      placeholder='搜索分析结果...'
      hintText='输入关键词搜索分析结果'
      itemKey={(a) => a.id}
      search={async (keyword, page) => {
        const res = await analysisApi.listAnalyses(page, DEFAULT_PAGE_SIZE, keyword)
        return { items: res.items, hasMore: res.hasMore ?? false }
      }}
      renderItem={(item) => (
        <>
          <View className='search-item-main'>
            <Text className='search-item-title'>{normalizeTitle(item.title)}</Text>
            <View className='search-item-meta'>
              <Text
                className='search-item-status'
                style={{ color: statusColor(item.status) }}
              >
                {statusLabel(item.status)}
              </Text>
              <Text>{formatTime(item.createdAt)}</Text>
            </View>
          </View>
          <Icon name='qianjin' size={28} color={IconColors.secondary} />
        </>
      )}
      onItemClick={(item) => {
        Taro.navigateTo({ url: `/pages/analysis/detail?id=${item.id}` })
      }}
      onBack={handleBack}
    />
  )
}
