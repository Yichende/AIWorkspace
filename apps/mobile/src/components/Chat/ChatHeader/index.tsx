import { View, Text } from '@tarojs/components'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useState } from 'react'
import { Popover } from '@nutui/nutui-react-taro'

import './index.scss'

interface Props {
  model: string
  onModelChange: (model: string) => void

  onBack?: () => void
  onMenu?: () => void

  showBack?: boolean
  showMenu?: boolean
}

const MODEL_OPTIONS = [
  {
    key: 'deepseek-r1',
    name: 'DeepSeek-R1',
  },
  {
    key: 'deepseek-v3',
    name: 'DeepSeek-V3',
  },
  {
    key: 'gpt-4o',
    name: 'GPT-4o',
  },
  {
    key: 'claude-4',
    name: 'Claude 4',
  },
]

export default function ChatHeader({
  model,
  onModelChange,
  onBack,
  onMenu,
  showBack = true,
  showMenu = true,
}: Props) {
  const [visible, setVisible] = useState(false)

  const handleSelect = (item: { key: string; name: string }) => {
    onModelChange(item.name)

    setVisible(false)
  }

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
            <View className='entry-btn' onClick={onMenu}>
              <Icon name='AI--' size={46} color={IconColors.secondary} />
            </View>
          )}
        </View>

        <Text className='main-title'>一叶</Text>
      </View>

      <View className='model-row'>
        <Popover
          visible={visible}
          location='bottom'
          list={MODEL_OPTIONS.map((item) => ({
            name: item.name,
            key: item.key,
          }))}
          onSelect={(item: any) => handleSelect(item)}
          onClose={() => setVisible(false)}
        >
          <View
            className='model-tag'
            onClick={() => {
              setVisible(true)
            }}
          >
            <Icon name='moxingku' size={20} color={IconColors.secondary} />

            <Text className='model-text'>{model}</Text>

            <Text className={`model-arrow ${visible ? 'open' : ''}`}>▼</Text>
          </View>
        </Popover>
      </View>
    </View>
  )
}
