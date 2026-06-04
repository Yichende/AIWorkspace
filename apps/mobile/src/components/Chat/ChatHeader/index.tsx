import { View, Text } from '@tarojs/components'
import { Icon } from '@my/ui'
import { useState } from 'react'
import { Popover } from '@nutui/nutui-react-taro'

import './index.scss'

interface Props {
  model: string
  onModelChange: (model: string) => void
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

export default function ChatHeader({ model, onModelChange }: Props) {
  const [visible, setVisible] = useState(false)

  const handleSelect = (item: { key: string; name: string }) => {
    onModelChange(item.name)

    setVisible(false)
  }

  return (
    <View className='chat-header'>
      <View className='status-bar-placeholder' />

      <View className='title-wrapper'>
        <View className='entry-btn'>
          <Icon name='caidan' size={24} />
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
          onClick={() => setVisible(!visible)}
          onOpen={() => setVisible(true)}
          onClose={() => setVisible(false)}
        >
          <View className='model-tag'>
            <Icon name='moxingku' size={20} />

            <Text className='model-text'>{model}</Text>

            <Text className={`model-arrow ${visible ? 'open' : ''}`}>▼</Text>
          </View>
        </Popover>
      </View>
    </View>
  )
}
