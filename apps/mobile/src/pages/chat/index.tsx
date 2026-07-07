import { View, ScrollView } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro from '@tarojs/taro'

import ChatHeader from '@/components/Chat/ChatHeader'
import ChatInput from '@/components/Chat/ChatInput'
import ChatMessage from '@/components/Chat/ChatMessage'
import ChatMenu from '@/components/Chat/ChatMenu'

import { useChatController } from '@/controllers/chat.controller'

import './index.scss'

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [menuVisible, setMenuVisible] = useState(false)
  const [sending, setSending] = useState(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    init,
    newChat,
    sendMessage,
    retryMessage,
    switchChat,
    // deleteChat,
    loadMoreMessages,
    loadMoreSessions,
    currentMessages,
    currentModel,
    historyGroups,
    messagesLoading,
    sessionsLoading,
    hasMoreSessions,
  } = useChatController()

  // Init: load persisted state on mount
  useEffect(() => {
    init()
  }, [])

  // ── Handlers ──

  const onBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  const onMenu = () => {
    setMenuVisible(true)
  }

  const handleNewChat = () => {
    newChat(currentModel)
  }

  const handleHistorySelect = (id: string) => {
    switchChat(id)
  }

  const handleModelChange = (model: string) => {
    // Model change creates a new session with the selected model
    newChat(model)
  }

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return

    const content = input
    setInput('')
    setSending(true)

    try {
      await sendMessage(content)
    } finally {
      setSending(false)
    }
  }, [input, sending, sendMessage])

  const handleRetry = useCallback(
    (messageId: string) => {
      retryMessage(messageId)
    },
    [retryMessage],
  )

  // ── Auto-scroll when messages change ──

  const scrollToBottom = useCallback(() => {
    // Use a short delay so the new message renders before we measure
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      // Taro page-level scroll — scroll to a hidden anchor at the bottom
      Taro.pageScrollTo({ scrollTop: 99999, duration: 200 })
    }, 80)
  }, [])

  useEffect(() => {
    scrollToBottom()
    return () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
    }
  }, [currentMessages.length, scrollToBottom])

  // ── Scroll to top → load more messages ──

  const handleScrollToUpper = useCallback(() => {
    loadMoreMessages()
  }, [loadMoreMessages])

  return (
    <>
      <View className='chat-page'>
        <ChatHeader onBack={onBack} onMenu={onMenu} />

        <View className='message-wrapper'>
          <ScrollView
            scrollY
            className='message-list'
            scrollTop={99999}
            scrollWithAnimation
            onScrollToUpper={handleScrollToUpper}
            upperThreshold={100}
          >
            {/* Loading indicator for older messages */}
            {messagesLoading && (
              <View className='messages-loading'>
                <View className='loading-dots'>
                  <View className='dot' />
                  <View className='dot' />
                  <View className='dot' />
                </View>
              </View>
            )}

            {currentMessages.map(msg => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onRetry={msg.status === 'error' || msg.status === 'sending' ? handleRetry : undefined}
              />
            ))}
            {/* Invisible anchor for scroll-to-bottom */}
            <View style={{ height: 1 }} />
          </ScrollView>
        </View>

        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
        />
      </View>

      <ChatMenu
        visible={menuVisible}
        currentModel={currentModel}
        historyGroups={historyGroups}
        hasMoreSessions={hasMoreSessions}
        sessionsLoading={sessionsLoading}
        onClose={() => setMenuVisible(false)}
        onModelChange={handleModelChange}
        onNewChat={handleNewChat}
        onHistorySelect={handleHistorySelect}
        onLoadMoreSessions={loadMoreSessions}
      />
    </>
  )
}
