import { create } from 'zustand'
import type { ChatMessage } from '@/types/chat'
import type { SessionIndexItem } from '@/services/chat.api'

// ── ChatSession (kept for backward compat with migration) ────

export interface ChatSession {
  id: string
  title: string
  model: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ── History grouping (for sidebar) ───────────────────────────

export type TimeGroup = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

export interface ChatHistoryGroup {
  label: string
  group: TimeGroup
  items: ChatHistoryItem[]
}

export interface ChatHistoryItem {
  id: string
  title: string
  createdAt: number
  model: string
}

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

// ── Helpers ──────────────────────────────────────────────────

const DAY = 86400000

function groupSession(ts: number): TimeGroup {
  const now = Date.now()
  const dayStart = now - (now % DAY)
  if (ts >= dayStart) return 'today'
  if (ts >= dayStart - DAY) return 'yesterday'
  if (ts >= dayStart - 7 * DAY) return 'thisWeek'
  return 'earlier'
}

const GROUP_LABEL: Record<TimeGroup, string> = {
  today: '今天',
  yesterday: '昨天',
  thisWeek: '最近一周',
  earlier: '更早',
}

/**
 * Build history groups from session index items (no messages needed).
 */
export function buildHistoryGroups(
  items: SessionIndexItem[],
): ChatHistoryGroup[] {
  const map = new Map<TimeGroup, ChatHistoryItem[]>()

  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)

  for (const s of sorted) {
    const g = groupSession(s.updatedAt)
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      model: s.model,
    })
  }

  const order: TimeGroup[] = ['today', 'yesterday', 'thisWeek', 'earlier']
  return order
    .filter((g) => map.has(g))
    .map((g) => ({ label: GROUP_LABEL[g], group: g, items: map.get(g)! }))
}

// ── ID generator ─────────────────────────────────────────────

let counter = 0
export function generateId(): string {
  counter++
  return `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`
}

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
