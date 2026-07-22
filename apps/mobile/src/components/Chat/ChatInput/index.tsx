import { View, Input } from '@tarojs/components'

import './index.scss'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
}

export default function ChatInput({ value, onChange, onSend }: Props) {
  return (
    <View className='chat-input-container'>
      <View className='chat-input'>
        {/* <View className='upload-btn'>+</View> */}

        <Input
          className='input'
          value={value}
          placeholder='请输入问题'
          onInput={(e) => onChange(e.detail.value)}
        />

        <View className='send-btn' onClick={onSend}>
          ➤
        </View>
      </View>
    </View>
  )
}
