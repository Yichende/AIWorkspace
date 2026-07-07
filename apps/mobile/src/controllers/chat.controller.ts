import { useChatStore, generateId, buildHistoryGroups } from '@/stores/chat.store'
import { chatStorage } from '@/stores/storage/chat'
import { chatApi } from '@/services/chat.api'
import { simulateAIReplyStream } from '@/services/chat.service'
import { migrateLegacyData } from '@/utils/migration'
import type { ChatMessage } from '@/types/chat'
import type { SessionIndexItem } from '@/services/chat.api'

// ── Throttle ─────────────────────────────────────────────────

/** 100ms — ~10 renders/sec, smooth enough for text streaming, gentle on Mini Program render thread */
const STREAM_THROTTLE_MS = 100

// ── Helpers ──────────────────────────────────────────────────

function truncateTitle(content: string, maxLen = 20): string {
  return content.length > maxLen ? content.slice(0, maxLen) + '…' : content
}

function createGreetingMessage(now: number): ChatMessage {
  const id = generateId()
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', content: '你好，我是一叶 AI。' }],
    status: 'success',
    createdAt: now,
  }
}

// ── Persist helpers ─────────────────────────────────────────

function persistCurrentSession(): void {
  const { currentSessionId, currentMessages, currentSessionMeta, sessionsIndex } =
    useChatStore.getState()

  if (currentSessionId && currentSessionMeta) {
    // Save current messages
    chatStorage.setSessionMessages(currentSessionId, currentMessages)
    // Update index entry for current session
    const idx = sessionsIndex.findIndex((s) => s.id === currentSessionId)
    if (idx >= 0) {
      sessionsIndex[idx] = {
        ...sessionsIndex[idx],
        title: currentSessionMeta.title,
        model: currentSessionMeta.model,
        updatedAt: Date.now(),
        messageCount: currentMessages.length,
      }
    }
    chatStorage.setSessionsIndex(sessionsIndex)
    chatStorage.setCurrentSessionId(currentSessionId)
  }
}

// ── Sync helpers ────────────────────────────────────────────

async function syncSessionsFromAPI(): Promise<void> {
  const store = useChatStore.getState()
  try {
    const { items, total } = await chatApi.listSessions(1, 20)
    store.setSessionsIndex(items, 1, items.length < total)
    chatStorage.setSessionsIndex(items)
  } catch {
    // Silently fail — local cache is already displayed
  }
}

async function syncMessagesFromAPI(sessionId: string): Promise<void> {
  try {
    const { messages, hasMore } = await chatApi.listMessages(sessionId, undefined, 20)
    useChatStore.getState().setMessages(messages, hasMore)
    chatStorage.setSessionMessages(sessionId, messages)
  } catch {
    // Silently fail — local cache is already displayed
  }
}

// ── Controller Hook ──────────────────────────────────────────

export function useChatController() {
  const store = useChatStore()

  // ── init ──────────────────────────────────────────────────

  /** Load persisted state + migrate + background sync */
  const init = async (): Promise<string | null> => {
    // 1. Migrate legacy data if needed (runs once)
    migrateLegacyData()

    // 2. Load local cache for instant render
    const localIndex = chatStorage.getSessionsIndex()
    const localCurrentId = chatStorage.getCurrentSessionId()

    if (localIndex.length > 0 && localCurrentId) {
      const localMsgs = chatStorage.getSessionMessages(localCurrentId)
      const meta = localIndex.find((i) => i.id === localCurrentId)
      store.hydrate(
        localIndex,
        localCurrentId,
        localMsgs,
        meta ? { title: meta.title, model: meta.model } : null,
      )

      // 3. Background API sync (don't block render)
      syncSessionsFromAPI()
      syncMessagesFromAPI(localCurrentId)

      return localCurrentId
    }

    // No local cache — create fresh session
    const sessionId = newChat('DeepSeek-R1')
    // Background sync
    syncSessionsFromAPI()
    return sessionId
  }

  // ── newChat ───────────────────────────────────────────────

  const newChat = (model: string): string => {
    const now = Date.now()
    const sessionId = generateId()
    const greeting = createGreetingMessage(now)

    const indexItem: SessionIndexItem = {
      id: sessionId,
      title: '新对话',
      model,
      messageCount: 1,
      createdAt: now,
      updatedAt: now,
    }

    // Local write (immediate)
    store.startNewSession(indexItem, [greeting])
    persistCurrentSession()

    // Async API write (fire-and-forget)
    chatApi
      .createSession({
        id: sessionId,
        title: '新对话',
        model,
        messages: [greeting],
      })
      .catch((err) => console.warn('[chat] Failed to sync new session:', err))

    return sessionId
  }

  // ── sendMessage ───────────────────────────────────────────

  const sendMessage = async (content: string): Promise<void> => {
    const trimmed = content.trim()
    if (!trimmed) return

    const state = useChatStore.getState()
    let sessionId = state.currentSessionId

    // Auto-create session if none exists
    if (!sessionId) {
      sessionId = newChat('DeepSeek-R1')
    }

    const now = Date.now()

    // 1. Create user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      blocks: [{ type: 'text', content: trimmed }],
      status: 'success',
      createdAt: now,
    }

    store.addMessage(userMsg)

    // 2. Auto-title from first user message
    const meta = useChatStore.getState().currentSessionMeta
    if (meta && meta.title === '新对话') {
      const newTitle = truncateTitle(trimmed)
      store.updateSessionInIndex(sessionId!, { title: newTitle })
      // Also update local meta
      useChatStore.setState({ currentSessionMeta: { ...meta, title: newTitle } })
    }

    // 3. Persist user message immediately
    persistCurrentSession()

    // 4. Async: sync user message to backend
    chatApi.saveMessage(sessionId!, userMsg).catch((err) =>
      console.warn('[chat] Failed to sync user message:', err),
    )

    // 5. Create placeholder assistant message
    const assistantMsgId = generateId()
    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [{ type: 'text', content: '' }],
      status: 'sending',
      createdAt: now + 1,
    }

    store.addMessage(assistantPlaceholder)

    // 6. Persist placeholder (for "响应中断" recovery on reload)
    persistCurrentSession()

    // 7. Stream AI reply with 100ms throttle
    let accumulated = ''
    let lastFlush = 0

    try {
      await simulateAIReplyStream(
        trimmed,
        // onDelta — throttle to ≤10 renders/sec
        (delta: string) => {
          accumulated += delta
          const tick = Date.now()
          if (tick - lastFlush >= STREAM_THROTTLE_MS) {
            // Safety: only update if still on the same session
            const cur = useChatStore.getState().currentSessionId
            if (cur === sessionId) {
              store.updateMessage(assistantMsgId, {
                blocks: [{ type: 'text', content: accumulated }],
                status: 'streaming',
              })
            }
            lastFlush = tick
          }
        },
        // onDone — final flush + persist + API sync
        (finalMessage: ChatMessage) => {
          store.updateMessage(assistantMsgId, {
            blocks: finalMessage.blocks,
            status: 'success',
          })
          persistCurrentSession()

          // Async: save final assistant message to backend
          chatApi.saveMessage(sessionId!, {
            ...finalMessage, id: assistantMsgId, createdAt: now + 1,
          }).catch((err) =>
            console.warn('[chat] Failed to sync assistant message:', err),
          )
        },
      )

      // 8. Final flush: ensure latest content and status
      const finalState = useChatStore.getState()
      const assistantMsg = finalState.currentMessages.find(
        (m) => m.id === assistantMsgId,
      )
      if (assistantMsg && assistantMsg.status !== 'success') {
        store.updateMessage(assistantMsgId, { status: 'success' })
        persistCurrentSession()
      }
    } catch {
      // 9. Error: mark as error, persist
      store.updateMessage(assistantMsgId, { status: 'error' })
      persistCurrentSession()
    }
  }

  // ── retryMessage ──────────────────────────────────────────

  /**
   * Retry a failed/interrupted assistant message.
   * Finds the preceding user message and re-runs the stream.
   */
  const retryMessage = async (assistantMsgId: string): Promise<void> => {
    const state = useChatStore.getState()
    const sessionId = state.currentSessionId
    if (!sessionId) return

    const messages = state.currentMessages
    const msgIdx = messages.findIndex((m) => m.id === assistantMsgId)
    if (msgIdx < 1) return

    const userMsg = messages[msgIdx - 1]
    if (userMsg.role !== 'user') return

    const userContent = userMsg.blocks.find((b) => b.type === 'text')?.content ?? ''
    if (!userContent) return

    // Reset assistant to sending
    store.updateMessage(assistantMsgId, {
      blocks: [{ type: 'text', content: '' }],
      status: 'sending',
    })

    let accumulated = ''
    let lastFlush = 0

    try {
      await simulateAIReplyStream(
        userContent,
        (delta: string) => {
          accumulated += delta
          const tick = Date.now()
          if (tick - lastFlush >= STREAM_THROTTLE_MS) {
            const cur = useChatStore.getState().currentSessionId
            if (cur === sessionId) {
              store.updateMessage(assistantMsgId, {
                blocks: [{ type: 'text', content: accumulated }],
                status: 'streaming',
              })
            }
            lastFlush = tick
          }
        },
        (finalMessage: ChatMessage) => {
          store.updateMessage(assistantMsgId, {
            blocks: finalMessage.blocks,
            status: 'success',
          })
          persistCurrentSession()

          chatApi.saveMessage(sessionId, {
            ...finalMessage, id: assistantMsgId, createdAt: Date.now(),
          }).catch((err) =>
            console.warn('[chat] Failed to sync retry message:', err),
          )
        },
      )

      const finalState = useChatStore.getState()
      const msg = finalState.currentMessages.find((m) => m.id === assistantMsgId)
      if (msg && msg.status !== 'success') {
        store.updateMessage(assistantMsgId, { status: 'success' })
        persistCurrentSession()
      }
    } catch {
      store.updateMessage(assistantMsgId, { status: 'error' })
      persistCurrentSession()
    }
  }

  // ── switchChat ────────────────────────────────────────────

  const switchChat = async (sessionId: string): Promise<void> => {
    // Save current session before switching
    persistCurrentSession()

    const meta = store.sessionsIndex.find((i) => i.id === sessionId)
    if (!meta) return

    // Switch store — clears currentMessages
    store.switchSession(sessionId, {
      title: meta.title,
      model: meta.model,
    })

    // Load from local cache first
    const localMsgs = chatStorage.getSessionMessages(sessionId)
    if (localMsgs.length > 0) {
      store.setMessages(localMsgs, true) // assume hasMore when loading from cache
    }

    // Background API sync (gets most recent + correct hasMore)
    syncMessagesFromAPI(sessionId)
  }

  // ── deleteChat ────────────────────────────────────────────

  const deleteChat = (sessionId: string): void => {
    store.removeSessionFromIndex(sessionId)
    chatStorage.removeSessionMessages(sessionId)
    persistCurrentSession() // update index in storage

    // Async API delete
    chatApi.deleteSession(sessionId).catch((err) =>
      console.warn('[chat] Failed to sync delete:', err),
    )
  }

  // ── loadMoreMessages ──────────────────────────────────────

  const loadMoreMessages = async (): Promise<void> => {
    const state = useChatStore.getState()
    if (state.messagesLoading || !state.hasMoreMessages || !state.currentSessionId) return

    store.setMessagesLoading(true)
    const oldest = state.currentMessages[0]

    try {
      const { messages, hasMore } = await chatApi.listMessages(
        state.currentSessionId,
        oldest?.createdAt,
      )
      store.prependMessages(messages, hasMore)
      // Update local cache
      chatStorage.prependSessionMessages(state.currentSessionId, messages)
    } catch (err) {
      console.warn('[chat] Failed to load more messages:', err)
    } finally {
      store.setMessagesLoading(false)
    }
  }

  // ── loadMoreSessions ──────────────────────────────────────

  const loadMoreSessions = async (): Promise<void> => {
    const state = useChatStore.getState()
    if (state.sessionsLoading || !state.hasMoreSessions) return

    store.setSessionsLoading(true)

    try {
      const { items, total } = await chatApi.listSessions(
        state.sessionsPage + 1,
        20,
      )
      store.appendSessionsIndex(items, state.sessionsPage + 1, items.length > 0 && (state.sessionsPage + 1) * 20 < total)
      // Update local cache
      chatStorage.setSessionsIndex([
        ...state.sessionsIndex,
        ...items,
      ])
    } catch (err) {
      console.warn('[chat] Failed to load more sessions:', err)
    } finally {
      store.setSessionsLoading(false)
    }
  }

  // ── Derived data ──────────────────────────────────────────

  const currentSession = store.currentSessionMeta
    ? {
        id: store.currentSessionId!,
        title: store.currentSessionMeta.title,
        model: store.currentSessionMeta.model,
        messages: store.currentMessages,
      }
    : null

  const historyGroups = buildHistoryGroups(store.sessionsIndex)

  return {
    // Actions
    init,
    newChat,
    sendMessage,
    retryMessage,
    switchChat,
    deleteChat,
    loadMoreMessages,
    loadMoreSessions,

    // State (read-only from store)
    sessionsIndex: store.sessionsIndex,
    currentSessionId: store.currentSessionId,
    currentSession,
    currentMessages: store.currentMessages,
    currentModel: store.currentSessionMeta?.model ?? 'DeepSeek-R1',
    historyGroups,
    messagesLoading: store.messagesLoading,
    sessionsLoading: store.sessionsLoading,
    hasMoreMessages: store.hasMoreMessages,
    hasMoreSessions: store.hasMoreSessions,
  }
}
