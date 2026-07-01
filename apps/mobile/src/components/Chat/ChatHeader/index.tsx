import { View, Text } from '@tarojs/components'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'

import './index.scss'

interface Props {
  onBack?: () => void
  onMenu?: () => void
  showBack?: boolean
  showMenu?: boolean
}

export default function ChatHeader({
  onBack,
  onMenu,
  showBack = true,
  showMenu = true,
}: Props) {
  return (
    <View className='chat-header'>
      <View className='status-bar-placeholder' />

      <View className='title-wrapper'>
        <View className='entry-group'>
          {showBack && (
            <View className='entry-btn' onClick={onBack}>
              <Icon name='fanhui' size={46} color={IconColors.accent} />
            </View>
          )}

          {showMenu && (
            <View className='entry-btn' onClick={() => {
              console.log('menu clicked')
              onMenu?.()
            }}
            >
              <Icon name='AI--' size={46} color={IconColors.secondary} />
            </View>
          )}
        </View>

        <Text className='main-title'>一叶</Text>
      </View>
    </View>
  )
}
