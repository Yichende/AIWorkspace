import { View, Input } from '@tarojs/components'

import './index.scss'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  /** AI 生成中 — 发送按钮切换为暂停图标 */
  streaming?: boolean
  onStop?: () => void
}

export default function ChatInput({ value, onChange, onSend, streaming, onStop }: Props) {
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

        {streaming ? (
          <View className='send-btn send-btn--stop' onClick={onStop}>
            <View className='pause-icon' />
          </View>
        ) : (
          <View className='send-btn' onClick={onSend}>
            ➤
          </View>
        )}
      </View>
    </View>
  )
}
