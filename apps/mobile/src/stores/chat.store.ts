import { create } from 'zustand'
import type { ChatMessage, SessionIndexItem } from '@repo/types'

// Re-export types for backward compatibility
export type { ChatSession } from '@repo/types'
export type { TimeGroup, ChatHistoryGroup, ChatHistoryItem } from '@repo/types'

// Re-export utilities (moved to @repo/utils, kept here for backward compat)
export { generateId, buildHistoryGroups } from '@repo/utils'

// ── State + Actions ──────────────────────────────────────────

interface ChatStoreState {
  /** Session metadata (lightweight, for sidebar) */
  sessionsIndex: SessionIndexItem[]
  /** Messages for the currently active session only */
  currentMessages: ChatMessage[]
  /** Current session identity */
  currentSessionMeta: { title: string; model: string } | null
  currentSessionId: string | null

  /** Pagination flags */
  sessionsLoading: boolean
  messagesLoading: boolean
  hasMoreSessions: boolean
  hasMoreMessages: boolean
  sessionsPage: number
}

interface ChatStoreActions {
  /** Restore state from pre-loaded data (controller calls this on init) */
  hydrate: (
    index: SessionIndexItem[],
    sessionId: string | null,
    messages: ChatMessage[],
    meta: { title: string; model: string } | null,
  ) => void

  // ── Index CRUD ────────────────────────────────────────────

  setSessionsIndex: (
    items: SessionIndexItem[],
    page: number,
    hasMore: boolean,
  ) => void
  appendSessionsIndex: (
    items: SessionIndexItem[],
    page: number,
    hasMore: boolean,
  ) => void
  addSessionToIndex: (item: SessionIndexItem) => void
  removeSessionFromIndex: (id: string) => void
  updateSessionInIndex: (
    id: string,
    patch: Partial<SessionIndexItem>,
  ) => void

  // ── Message CRUD (current session only) ────────────────────

  setMessages: (messages: ChatMessage[], hasMore: boolean) => void
  prependMessages: (messages: ChatMessage[], hasMore: boolean) => void
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void

  // ── Session navigation ────────────────────────────────────

  /** Create a new session: add to index + set as current + set messages */
  startNewSession: (
    indexItem: SessionIndexItem,
    messages: ChatMessage[],
  ) => void,

  switchSession: (
    id: string,
    meta: { title: string; model: string },
  ) => void
  clearCurrentSession: () => void

  // ── Loading flags ─────────────────────────────────────────

  setSessionsLoading: (loading: boolean) => void
  setMessagesLoading: (loading: boolean) => void
}

export type ChatStore = ChatStoreState & ChatStoreActions

// ── Store ────────────────────────────────────────────────────

export const useChatStore = create<ChatStore>((set) => ({
  sessionsIndex: [],
  currentMessages: [],
  currentSessionMeta: null,
  currentSessionId: null,

  sessionsLoading: false,
  messagesLoading: false,
  hasMoreSessions: true,
  hasMoreMessages: true,
  sessionsPage: 0,

  // ── hydrate ───────────────────────────────────────────────

  hydrate: (index, sessionId, messages, meta) =>
    set({
      sessionsIndex: index,
      currentSessionId: sessionId,
      currentMessages: messages,
      currentSessionMeta: meta,
    }),

  // ── Index CRUD ────────────────────────────────────────────

  setSessionsIndex: (items, page, hasMore) =>
    set({
      sessionsIndex: items,
      sessionsPage: page,
      hasMoreSessions: hasMore,
    }),

  appendSessionsIndex: (items, page, hasMore) =>
    set((state) => ({
      sessionsIndex: [...state.sessionsIndex, ...items],
      sessionsPage: page,
      hasMoreSessions: hasMore,
    })),

  addSessionToIndex: (item) =>
    set((state) => ({
      sessionsIndex: [item, ...state.sessionsIndex],
    })),

  removeSessionFromIndex: (id) =>
    set((state) => ({
      sessionsIndex: state.sessionsIndex.filter((s) => s.id !== id),
    })),

  updateSessionInIndex: (id, patch) =>
    set((state) => ({
      sessionsIndex: state.sessionsIndex.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    })),

  // ── Message CRUD ──────────────────────────────────────────

  setMessages: (messages, hasMore) =>
    set({ currentMessages: messages, hasMoreMessages: hasMore }),

  prependMessages: (messages, hasMore) =>
    set((state) => ({
      currentMessages: [...messages, ...state.currentMessages],
      hasMoreMessages: hasMore,
    })),

  addMessage: (message) =>
    set((state) => ({
      currentMessages: [...state.currentMessages, message],
      // Update index updatedAt + messageCount for current session
      sessionsIndex: state.sessionsIndex.map((s) =>
        s.id === state.currentSessionId
          ? {
              ...s,
              updatedAt: Date.now(),
              messageCount: state.currentMessages.length + 1,
            }
          : s,
      ),
    })),

  updateMessage: (id, patch) =>
    set((state) => ({
      currentMessages: state.currentMessages.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    })),

  // ── Session navigation ────────────────────────────────────

  startNewSession: (indexItem, messages) =>
    set((state) => ({
      sessionsIndex: [indexItem, ...state.sessionsIndex],
      currentSessionId: indexItem.id,
      currentSessionMeta: {
        title: indexItem.title,
        model: indexItem.model,
      },
      currentMessages: messages,
      hasMoreMessages: true,
    })),

  switchSession: (id, meta) =>
    set({
      currentSessionId: id,
      currentSessionMeta: meta,
      currentMessages: [],
      hasMoreMessages: true,
    }),

  clearCurrentSession: () =>
    set({
      currentSessionId: null,
      currentSessionMeta: null,
      currentMessages: [],
      hasMoreMessages: true,
    }),

  // ── Loading flags ─────────────────────────────────────────

  setSessionsLoading: (loading) => set({ sessionsLoading: loading }),
  setMessagesLoading: (loading) => set({ messagesLoading: loading }),
}))
