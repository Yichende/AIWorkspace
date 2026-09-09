import { View, Input } from '@tarojs/components'

import './index.scss'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  /** AI 生成中 — 发送按钮切换为暂停图标 */
  streaming?: boolean
  onStop?: () => void
  /** 当前会话实际使用的模型展示名（输入框下方提示行） */
  modelName?: string
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  streaming,
  onStop,
  modelName,
}: Props) {
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

      {/* 模型提示：让用户明确当前页面实际使用的模型 */}
      {modelName && (
        <View className='chat-input__model-hint'>
          本页对话由 {modelName} 生成，请注意核实
        </View>
      )}
    </View>
  )
}
