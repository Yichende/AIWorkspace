import { View, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import { ChatMessage as IMessage } from '@/types/chat'

import ChatHeader from '@/components/Chat/ChatHeader'
import ChatInput from '@/components/Chat/ChatInput'
import ChatMessage from '@/components/Chat/ChatMessage'

import './index.scss'

export default function ChatPage() {
  const [input, setInput] = useState('')
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

  return (
    <View className='chat-page'>
      <ChatHeader model={currentModel} onModelChange={setCurrentModel} />
      <View className='message-wrapper'>
        <ScrollView scrollY className='message-list'>
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
        </ScrollView>
      </View>

      <ChatInput value={input} onChange={setInput} onSend={() => {}} />
    </View>
  )
}
