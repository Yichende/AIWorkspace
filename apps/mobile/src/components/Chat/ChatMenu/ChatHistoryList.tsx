import { View, Text } from '@tarojs/components'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import type { ChatHistoryGroup } from '@/stores/mock/chat.store'

interface Props {
  groups: ChatHistoryGroup[]
  onSelect: (id: string) => void
}

export default function ChatHistoryList({ groups, onSelect }: Props) {
  if (!groups.length) {
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
    </View>
  )
}
