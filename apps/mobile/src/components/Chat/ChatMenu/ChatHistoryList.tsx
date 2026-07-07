import { View, Text } from '@tarojs/components'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import type { ChatHistoryGroup } from '@/stores/chat.store'

interface Props {
  groups: ChatHistoryGroup[]
  hasMore: boolean
  loading: boolean
  onSelect: (id: string) => void
  onLoadMore?: () => void
}

export default function ChatHistoryList({
  groups,
  hasMore,
  loading,
  onSelect,
  onLoadMore,
}: Props) {
  if (!groups.length && !loading) {
    return (
      <View className='history-empty'>
        <Icon name='duihuaxiaoxi' size={64} color={IconColors.secondary} />
        <Text className='empty-text'>暂无对话记录</Text>
      </View>
    )
  }

  return (
    <View className='chat-history-list'>
      {groups.map((group) => (
        <View key={group.group} className='history-group'>
          <Text className='group-label'>{group.label}</Text>

          {group.items.map((item) => (
            <View
              key={item.id}
              className='history-item'
              onClick={() => onSelect(item.id)}
            >
              <View className='history-item-content'>
                <Text className='history-item-title'>{item.title}</Text>
                <Text className='history-item-model'>{item.model}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}

      {/* Load more sessions */}
      {hasMore && (
        <View
          className='history-load-more'
          onClick={loading ? undefined : onLoadMore}
        >
          {loading ? (
            <View className='load-more-loading'>
              <View className='loading-dots'>
                <View className='dot' />
                <View className='dot' />
                <View className='dot' />
              </View>
            </View>
          ) : (
            <Text className='load-more-text'>加载更多</Text>
          )}
        </View>
      )}
    </View>
  )
}
