import { View, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import { ChatMessage as IMessage } from '@/types/chat'

import Taro from '@tarojs/taro'
import ChatHeader from '@/components/Chat/ChatHeader'
import ChatInput from '@/components/Chat/ChatInput'
import ChatMessage from '@/components/Chat/ChatMessage'
import ChatMenu from '@/components/Chat/ChatMenu'


import './index.scss'

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [menuVisible, setMenuVisible] = useState(false)
  const [currentModel, setCurrentModel] = useState('DeepSeek-R1')
  const [messages] = useState<IMessage[]>([
    {
      id: '1',
      role: 'assistant',
      createdAt: Date.now(),
      blocks: [
        {
          type: 'text',
          content: '你好，我是一叶 AI。',
        },
      ],
    },
  ])

  const onBack = () =>{
    Taro.navigateBack({
      delta: 1
    })
  }

  const onMenu = () => {
    setMenuVisible(true)
  }

  const handleNewChat = () => {
    // TODO: 创建新对话逻辑
  }

  const handleHistorySelect = (id: string) => {
    // TODO: 加载历史对话
    console.log('Select history:', id)
  }

  return (
    <>
      <View className='chat-page'>
        <ChatHeader
          onBack={onBack}
          onMenu={onMenu}
        />

        <View className='message-wrapper'>
          <ScrollView scrollY className='message-list'>
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
          </ScrollView>
        </View>

        <ChatInput value={input} onChange={setInput} onSend={() => {}} />
      </View>

      <ChatMenu
        visible={menuVisible}
        currentModel={currentModel}
        onClose={() => setMenuVisible(false)}
        onModelChange={setCurrentModel}
        onNewChat={handleNewChat}
        onHistorySelect={handleHistorySelect}
      />
    </>
  )
}
