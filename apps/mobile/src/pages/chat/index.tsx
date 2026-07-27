import { View, ScrollView } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'

import ChatHeader from '@/components/Chat/ChatHeader'
import ChatInput from '@/components/Chat/ChatInput'
import ChatMessage from '@/components/Chat/ChatMessage'
import ChatMenu from '@/components/Chat/ChatMenu'

import { useChatController } from '@/controllers/chat.controller'
import { modelApi } from '@/services/model.api'
import { AI_MODELS } from '@repo/types'
import type { ModelListItem } from '@repo/types'

import './index.scss'

export default function ChatPage() {
  const [input, setInput] = useState('')
  const [menuVisible, setMenuVisible] = useState(false)
  const [sending, setSending] = useState(false)
  // Dynamic scrollTop tick — incrementing it forces ScrollView to re-apply scrollTop
  const [scrollTopTick, setScrollTopTick] = useState(1)

  // Model list: start with built-in models as fallback, then fetch merged list
  const [models, setModels] = useState<ModelListItem[]>(
    AI_MODELS.map((m) => ({
      id: m.id,
      displayName: m.id,
      protocolType: undefined,
      provider: m.provider,
      supportsThinking: m.supportsThinking,
      source: 'builtin' as const,
    })),
  )

  // Refresh model list on mount and when returning from addModel page
  const fetchModels = useCallback(async () => {
    try {
      const res = await modelApi.listModels()
      if (res.models?.length > 0) {
        setModels(res.models)
      }
    } catch {
      // Keep current models (builtin fallback) on error
    }
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  useDidShow(() => {
    fetchModels()
  })

  const {
    init,
    newChat,
    switchModel,
    sendMessage,
    retryMessage,
    switchChat,
    deleteChat,
    batchDeleteChats,
    renameChat,
    loadMoreMessages,
    loadMoreSessions,
    currentMessages,
    currentSessionId,
    currentModel,
    historyGroups,
    messagesLoading,
    sessionsLoading,
    hasMoreSessions,
  } = useChatController()

  // Init: load persisted state on mount
  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Switch model on current session — does NOT create a new chat
    switchModel(model)
  }

  const handleAddModel = () => {
    setMenuVisible(false)
    Taro.navigateTo({ url: '/pages/addModel/index' })
  }

  const handleEditModel = (modelId: string) => {
    setMenuVisible(false)
    const model = models.find((m) => m.id === modelId)
    const source = model?.source ?? 'custom'
    Taro.navigateTo({
      url: `/pages/addModel/index?modelId=${modelId}&source=${source}`,
    })
  }

  const handleDeleteModel = async (modelId: string) => {
    try {
      await modelApi.deleteModel(modelId)
      Taro.showToast({ title: '模型已删除', icon: 'success' })
      // Refresh model list
      fetchModels()
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' })
    }
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

  const handleDelete = useCallback(
    (sessionId: string) => {
      // If deleting current session, switch to a new chat
      if (sessionId === currentSessionId) {
        newChat(currentModel)
      }
      deleteChat(sessionId)
    },
    [deleteChat, currentSessionId, currentModel, newChat],
  )

  const handleRename = useCallback(
    (sessionId: string, newTitle: string) => {
      renameChat(sessionId, newTitle)
    },
    [renameChat],
  )

  const handleBatchDelete = useCallback(
    (ids: string[]) => {
      // 如果批量删除中包含当前会话，先切换到新对话
      if (ids.includes(currentSessionId!)) {
        newChat(currentModel)
      }
      batchDeleteChats(ids)
    },
    [batchDeleteChats, currentSessionId, currentModel, newChat],
  )

  // ── Auto-scroll when messages/content change ──

  // Compute a content fingerprint: sum of all text block lengths
  // This triggers scroll on every content change during streaming
  const contentFingerprint = currentMessages.reduce(
    (sum, m) =>
      sum +
      m.blocks.reduce(
        (s, b) =>
          s + (b.type === 'text' ? ((b as any).content?.length ?? 0) : 0),
        0,
      ),
    0,
  )

  const isStreaming = currentMessages.some(
    (m) => m.status === 'streaming' || m.status === 'sending',
  )

  // Dynamic scrollTop: increment tick on content growth during streaming
  const prevFingerprintRef = useRef(contentFingerprint)
  const lastScrollTickRef = useRef(Date.now())
  useEffect(() => {
    if (isStreaming && contentFingerprint > prevFingerprintRef.current) {
      prevFingerprintRef.current = contentFingerprint
      // Throttle scroll updates to ~120ms for smooth visual
      const now = Date.now()
      if (now - lastScrollTickRef.current > 120) {
        lastScrollTickRef.current = now
        setScrollTopTick((t) => t + 1)
      }
    }
    if (!isStreaming) {
      prevFingerprintRef.current = contentFingerprint
    }
  }, [contentFingerprint, isStreaming])

  // Scroll on message count change (new message added)
  useEffect(() => {
    setScrollTopTick((t) => t + 1)
  }, [currentMessages.length])

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
            scrollTop={scrollTopTick * 99999}
            scrollWithAnimation
            showScrollbar={false}
            enhanced
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

            {currentMessages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onRetry={
                  msg.status === 'error' || msg.status === 'sending'
                    ? handleRetry
                    : undefined
                }
              />
            ))}
            {/* Invisible anchor for scroll-to-bottom */}
            <View style={{ height: 1 }} />
          </ScrollView>
        </View>

        <ChatInput value={input} onChange={setInput} onSend={handleSend} />
      </View>

      <ChatMenu
        visible={menuVisible}
        currentModel={currentModel}
        currentSessionId={currentSessionId}
        historyGroups={historyGroups}
        hasMoreSessions={hasMoreSessions}
        sessionsLoading={sessionsLoading}
        models={models}
        onClose={() => setMenuVisible(false)}
        onModelChange={handleModelChange}
        onAddModel={handleAddModel}
        onEditModel={handleEditModel}
        onDeleteModel={handleDeleteModel}
        onNewChat={handleNewChat}
        onHistorySelect={handleHistorySelect}
        onDeleteChat={handleDelete}
        onRenameChat={handleRename}
        onLoadMoreSessions={loadMoreSessions}
        onBatchDelete={handleBatchDelete}
      />
    </>
  )
}
