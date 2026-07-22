import {
  useChatStore,
  generateId,
  buildHistoryGroups,
} from '@/stores/chat.store'
import { chatStorage } from '@/stores/storage/chat'
import { chatApi } from '@/services/chat.api'
import { migrateLegacyData } from '@/utils/migration'
import { truncateTitle } from '@repo/utils'
import {
  DEFAULT_MODEL,
  DEFAULT_SESSION_TITLE,
  DEFAULT_PAGE_SIZE,
  GREETING_TEXT,
} from '@repo/constants'
import type { ChatMessage, SessionIndexItem, MessageBlock } from '@repo/types'

// ── Throttle ─────────────────────────────────────────────────

/** 100ms — ~10 renders/sec, smooth enough for text streaming, gentle on Mini Program render thread */
const STREAM_THROTTLE_MS = 100

// ── Helpers ──────────────────────────────────────────────────

function createGreetingMessage(now: number): ChatMessage {
  const id = generateId()
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', content: GREETING_TEXT }],
    status: 'success',
    createdAt: now,
  }
}

// ── Persist helpers ─────────────────────────────────────────

function persistCurrentSession(): void {
  const {
    currentSessionId,
    currentMessages,
    currentSessionMeta,
    sessionsIndex,
  } = useChatStore.getState()

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
    const { items, total } = await chatApi.listSessions(1, DEFAULT_PAGE_SIZE)
    store.setSessionsIndex(items, 1, items.length < total)
    chatStorage.setSessionsIndex(items)
  } catch {
    // Silently fail — local cache is already displayed
  }
}

async function syncMessagesFromAPI(sessionId: string): Promise<void> {
  try {
    const { messages, hasMore } = await chatApi.listMessages(
      sessionId,
      undefined,
      DEFAULT_PAGE_SIZE,
    )
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
    const sessionId = newChat(DEFAULT_MODEL)
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
      title: DEFAULT_SESSION_TITLE,
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
        title: DEFAULT_SESSION_TITLE,
        model,
        messages: [greeting],
      })
      .catch((err) => console.warn('[chat] Failed to sync new session:', err))

    return sessionId
  }

  // ── switchModel ───────────────────────────────────────────

  /** Switch model on the current session without creating a new chat */
  const switchModel = (model: string): void => {
    const state = useChatStore.getState()
    if (state.currentSessionId && state.currentSessionMeta) {
      // Update current session's model
      useChatStore.setState({
        currentSessionMeta: { ...state.currentSessionMeta, model },
      })
      store.updateSessionInIndex(state.currentSessionId, { model })
      // Persist updated index
      const currentIndex = chatStorage.getSessionsIndex()
      const updatedIndex = currentIndex.map((s) =>
        s.id === state.currentSessionId ? { ...s, model } : s,
      )
      chatStorage.setSessionsIndex(updatedIndex)
      // Async sync to server
      chatApi
        .updateSession(state.currentSessionId, { title: state.currentSessionMeta.title })
        .catch((err) => console.warn('[chat] Failed to sync model switch:', err))
    } else {
      // No current session — create one
      newChat(model)
    }
  }

  // ── sendMessage ───────────────────────────────────────────

  const sendMessage = async (content: string): Promise<void> => {
    const trimmed = content.trim()
    if (!trimmed) return

    const state = useChatStore.getState()
    let sessionId = state.currentSessionId

    // Auto-create session if none exists
    if (!sessionId) {
      sessionId = newChat(DEFAULT_MODEL)
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
    if (meta && meta.title === DEFAULT_SESSION_TITLE) {
      const newTitle = truncateTitle(trimmed)
      store.updateSessionInIndex(sessionId!, { title: newTitle })
      // Also update local meta
      useChatStore.setState({
        currentSessionMeta: { ...meta, title: newTitle },
      })
    }

    // 3. Persist user message immediately
    persistCurrentSession()

    // 4. Async: sync user message to backend
    chatApi
      .saveMessage(sessionId!, userMsg)
      .catch((err) => console.warn('[chat] Failed to sync user message:', err))

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

    // 7. Build message history for AI context
    const currentState = useChatStore.getState()
    const historyMessages: Array<{ role: string; content: string }> = []

    // Include successful messages as context (up to last 20)
    const contextMsgs = currentState.currentMessages
      .filter((m) => m.status === 'success')
      .filter((m) => {
        // 过滤系统生成的问候语，不发送给 AI
        const text = m.blocks.find((b) => b.type === 'text')?.content ?? ''
        return text !== GREETING_TEXT
      })
      .slice(-20)
    for (const m of contextMsgs) {
      const text = m.blocks.find((b) => b.type === 'text')?.content ?? ''
      if (text) {
        historyMessages.push({ role: m.role, content: text })
      }
    }

    // 8. Stream AI reply with thinking/content separation
    let thinkAccumulated = ''
    let contentAccumulated = ''
    let lastFlush = 0

    const flushBlocks = () => {
      const blocks: MessageBlock[] = []
      if (thinkAccumulated) {
        blocks.push({ type: 'text', content: thinkAccumulated, thinking: true })
      }
      if (contentAccumulated) {
        blocks.push({ type: 'text', content: contentAccumulated })
      }
      if (blocks.length === 0) {
        blocks.push({ type: 'text', content: '' })
      }
      const cur = useChatStore.getState().currentSessionId
      if (cur === sessionId) {
        store.updateMessage(assistantMsgId, {
          blocks,
          status: 'streaming',
        })
      }
    }

    try {
      await chatApi.streamCompletion(
        meta?.model ?? DEFAULT_MODEL,
        historyMessages,
        {
          onThinking: (text: string) => {
            // Dedup guard: if Ollama sends full accumulated text (not delta),
            // text will start with what we already have. Extract only the new part.
            if (text.startsWith(thinkAccumulated)) {
              const delta = text.slice(thinkAccumulated.length)
              if (!delta) return
              thinkAccumulated = text
              const tick = Date.now()
              if (tick - lastFlush >= STREAM_THROTTLE_MS) {
                flushBlocks()
                lastFlush = tick
              }
              return
            }
            thinkAccumulated += text
            const tick = Date.now()
            if (tick - lastFlush >= STREAM_THROTTLE_MS) {
              flushBlocks()
              lastFlush = tick
            }
          },
          onContent: (text: string) => {
            // Same dedup guard for content deltas
            if (text.startsWith(contentAccumulated)) {
              const delta = text.slice(contentAccumulated.length)
              if (!delta) return
              contentAccumulated = text
              const tick = Date.now()
              if (tick - lastFlush >= STREAM_THROTTLE_MS) {
                flushBlocks()
                lastFlush = tick
              }
              return
            }
            contentAccumulated += text
            const tick = Date.now()
            if (tick - lastFlush >= STREAM_THROTTLE_MS) {
              flushBlocks()
              lastFlush = tick
            }
          },
          onDone: (fullText: string) => {
            // Final flush
            const blocks: MessageBlock[] = []
            if (thinkAccumulated) {
              blocks.push({
                type: 'text',
                content: thinkAccumulated,
                thinking: true,
              })
            }
            if (contentAccumulated) {
              blocks.push({ type: 'text', content: contentAccumulated })
            }
            if (blocks.length === 0) {
              blocks.push({
                type: 'text',
                content: fullText || '（无回复内容）',
              })
            }
            store.updateMessage(assistantMsgId, {
              blocks,
              status: 'success',
            })
            persistCurrentSession()

            // Async: save final assistant message to backend
            const finalMsg = {
              id: assistantMsgId,
              role: 'assistant' as const,
              blocks,
              status: 'success' as const,
              createdAt: now + 1,
            }
            chatApi
              .saveMessage(sessionId!, finalMsg)
              .catch((err) =>
                console.warn('[chat] Failed to sync assistant message:', err),
              )
          },
          onError: (err: string) => {
            store.updateMessage(assistantMsgId, { status: 'error' })
            persistCurrentSession()
          },
        },
      )

      // 9. Final flush: ensure latest content and status
      const finalState = useChatStore.getState()
      const assistantMsg = finalState.currentMessages.find(
        (m) => m.id === assistantMsgId,
      )
      if (assistantMsg && assistantMsg.status !== 'success') {
        store.updateMessage(assistantMsgId, { status: 'success' })
        persistCurrentSession()
      }
    } catch {
      // 10. Error: mark as error, persist
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

    const userContent =
      userMsg.blocks.find((b) => b.type === 'text')?.content ?? ''
    if (!userContent) return

    // Reset assistant to sending
    store.updateMessage(assistantMsgId, {
      blocks: [{ type: 'text', content: '' }],
      status: 'sending',
    })

    let thinkAccumulated = ''
    let contentAccumulated = ''
    let lastFlush = 0

    const flushBlocks = () => {
      const blocks: MessageBlock[] = []
      if (thinkAccumulated) {
        blocks.push({ type: 'text', content: thinkAccumulated, thinking: true })
      }
      if (contentAccumulated) {
        blocks.push({ type: 'text', content: contentAccumulated })
      }
      if (blocks.length === 0) {
        blocks.push({ type: 'text', content: '' })
      }
      const cur = useChatStore.getState().currentSessionId
      if (cur === sessionId) {
        store.updateMessage(assistantMsgId, {
          blocks,
          status: 'streaming',
        })
      }
    }

    try {
      // Build context from messages before the retry
      const currentState = useChatStore.getState()
      const historyMessages: Array<{ role: string; content: string }> = []
      const contextMsgs = currentState.currentMessages
        .filter((m) => m.status === 'success' && m.id !== assistantMsgId)
        .filter((m) => {
          const text = m.blocks.find((b) => b.type === 'text')?.content ?? ''
          return text !== GREETING_TEXT
        })
        .slice(-20)
      for (const m of contextMsgs) {
        const text = m.blocks.find((b) => b.type === 'text')?.content ?? ''
        if (text) {
          historyMessages.push({ role: m.role, content: text })
        }
      }

      await chatApi.streamCompletion(
        state.currentSessionMeta?.model ?? DEFAULT_MODEL,
        historyMessages,
        {
          onThinking: (text: string) => {
            if (text.startsWith(thinkAccumulated)) {
              const delta = text.slice(thinkAccumulated.length)
              if (!delta) return
              thinkAccumulated = text
              const tick = Date.now()
              if (tick - lastFlush >= STREAM_THROTTLE_MS) {
                flushBlocks()
                lastFlush = tick
              }
              return
            }
            thinkAccumulated += text
            const tick = Date.now()
            if (tick - lastFlush >= STREAM_THROTTLE_MS) {
              flushBlocks()
              lastFlush = tick
            }
          },
          onContent: (text: string) => {
            if (text.startsWith(contentAccumulated)) {
              const delta = text.slice(contentAccumulated.length)
              if (!delta) return
              contentAccumulated = text
              const tick = Date.now()
              if (tick - lastFlush >= STREAM_THROTTLE_MS) {
                flushBlocks()
                lastFlush = tick
              }
              return
            }
            contentAccumulated += text
            const tick = Date.now()
            if (tick - lastFlush >= STREAM_THROTTLE_MS) {
              flushBlocks()
              lastFlush = tick
            }
          },
          onDone: (fullText: string) => {
            const blocks: MessageBlock[] = []
            if (thinkAccumulated) {
              blocks.push({
                type: 'text',
                content: thinkAccumulated,
                thinking: true,
              })
            }
            if (contentAccumulated) {
              blocks.push({ type: 'text', content: contentAccumulated })
            }
            if (blocks.length === 0) {
              blocks.push({
                type: 'text',
                content: fullText || '（无回复内容）',
              })
            }
            store.updateMessage(assistantMsgId, {
              blocks,
              status: 'success',
            })
            persistCurrentSession()

            const finalMsg = {
              id: assistantMsgId,
              role: 'assistant' as const,
              blocks,
              status: 'success' as const,
              createdAt: Date.now(),
            }
            chatApi
              .saveMessage(sessionId, finalMsg)
              .catch((err) =>
                console.warn('[chat] Failed to sync retry message:', err),
              )
          },
          onError: () => {
            store.updateMessage(assistantMsgId, { status: 'error' })
            persistCurrentSession()
          },
        },
      )

      const finalState = useChatStore.getState()
      const msg = finalState.currentMessages.find(
        (m) => m.id === assistantMsgId,
      )
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
    // 1. Remove from store (immediate UI)
    store.removeSessionFromIndex(sessionId)

    // 2. Remove messages from local storage
    chatStorage.removeSessionMessages(sessionId)

    // 3. Save updated index to storage directly (don't rely on persistCurrentSession,
    //    which may have side effects with current session state)
    const updatedIndex = useChatStore.getState().sessionsIndex
    chatStorage.setSessionsIndex(updatedIndex)

    // 4. If the deleted session was current, clear current session storage ref
    if (chatStorage.getCurrentSessionId() === sessionId) {
      chatStorage.setCurrentSessionId(null)
    }

    // 5. Async API delete
    chatApi
      .deleteSession(sessionId)
      .catch((err) => console.warn('[chat] Failed to sync delete:', err))
  }

  // ── renameChat ─────────────────────────────────────────────

  const renameChat = (sessionId: string, newTitle: string): void => {
    // 1. Update store index (immediate UI feedback)
    store.updateSessionInIndex(sessionId, { title: newTitle })

    // 2. Update current session meta if renaming the active session
    const state = useChatStore.getState()
    if (state.currentSessionId === sessionId && state.currentSessionMeta) {
      useChatStore.setState({
        currentSessionMeta: { ...state.currentSessionMeta, title: newTitle },
      })
    }

    // 3. Update local storage index
    const currentIndex = chatStorage.getSessionsIndex()
    const updatedIndex = currentIndex.map((s) =>
      s.id === sessionId ? { ...s, title: newTitle } : s,
    )
    chatStorage.setSessionsIndex(updatedIndex)

    // 4. Async API sync
    chatApi
      .updateSession(sessionId, { title: newTitle })
      .catch((err) => console.warn('[chat] Failed to sync rename:', err))
  }

  // ── loadMoreMessages ──────────────────────────────────────

  const loadMoreMessages = async (): Promise<void> => {
    const state = useChatStore.getState()
    if (
      state.messagesLoading ||
      !state.hasMoreMessages ||
      !state.currentSessionId
    )
      return

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
        DEFAULT_PAGE_SIZE,
      )
      store.appendSessionsIndex(
        items,
        state.sessionsPage + 1,
        items.length > 0 &&
          (state.sessionsPage + 1) * DEFAULT_PAGE_SIZE < total,
      )
      // Update local cache
      chatStorage.setSessionsIndex([...state.sessionsIndex, ...items])
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
    switchModel,
    sendMessage,
    retryMessage,
    switchChat,
    deleteChat,
    renameChat,
    loadMoreMessages,
    loadMoreSessions,

    // State (read-only from store)
    sessionsIndex: store.sessionsIndex,
    currentSessionId: store.currentSessionId,
    currentSession,
    currentMessages: store.currentMessages,
    currentModel: store.currentSessionMeta?.model ?? DEFAULT_MODEL,
    historyGroups,
    messagesLoading: store.messagesLoading,
    sessionsLoading: store.sessionsLoading,
    hasMoreMessages: store.hasMoreMessages,
    hasMoreSessions: store.hasMoreSessions,
  }
}
