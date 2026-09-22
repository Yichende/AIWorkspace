import Taro from '@tarojs/taro'
import type { ChatMessage, SessionIndexItem } from '@repo/types'

// ── Storage keys ────────────────────────────────────────────

const KEYS = {
  INDEX: 'chat_sessions_index',
  MSGS_PREFIX: 'chat_msgs_',
  CURRENT: 'chat_current_session',
  CACHED_LIST: 'chat_cached_sessions', // track which sessions have local msg cache
} as const

// ── Limits ──────────────────────────────────────────────────

const MAX_INDEX_SIZE = 50
const MAX_CACHED_SESSIONS = 5

// ── Helpers ──────────────────────────────────────────────────

function msgKey(sessionId: string): string {
  return `${KEYS.MSGS_PREFIX}${sessionId}`
}

function getCachedSessionIds(): string[] {
  try {
    return Taro.getStorageSync(KEYS.CACHED_LIST) || []
  } catch {
    return []
  }
}

function setCachedSessionIds(ids: string[]): void {
  Taro.setStorageSync(KEYS.CACHED_LIST, ids)
}

// ── Public API ───────────────────────────────────────────────

export const chatStorage = {
  // ── Sessions index ───────────────────────────────────────

  getSessionsIndex(): SessionIndexItem[] {
    try {
      return Taro.getStorageSync(KEYS.INDEX) || []
    } catch {
      return []
    }
  },

  setSessionsIndex(items: SessionIndexItem[]): void {
    // Cap at MAX_INDEX_SIZE
    const capped = items.slice(0, MAX_INDEX_SIZE)
    Taro.setStorageSync(KEYS.INDEX, capped)
  },

  // ── Messages per session ─────────────────────────────────

  getSessionMessages(sessionId: string): ChatMessage[] {
    try {
      return Taro.getStorageSync(msgKey(sessionId)) || []
    } catch {
      return []
    }
  },

  setSessionMessages(sessionId: string, msgs: ChatMessage[]): void {
    // Track this session as cached
    const cached = getCachedSessionIds().filter((id) => id !== sessionId)
    cached.unshift(sessionId) // move to front (most recently used)

    // Evict oldest if over limit
    while (cached.length > MAX_CACHED_SESSIONS) {
      const evicted = cached.pop()!
      Taro.removeStorageSync(msgKey(evicted))
    }

    setCachedSessionIds(cached)
    Taro.setStorageSync(msgKey(sessionId), msgs)
  },

  /** Prepend older messages loaded from API (maintains chronological order) */
  prependSessionMessages(sessionId: string, msgs: ChatMessage[]): void {
    const existing = chatStorage.getSessionMessages(sessionId)
    // Deduplicate by id, then prepend
    const existingIds = new Set(existing.map((m) => m.id))
    const newMsgs = msgs.filter((m) => !existingIds.has(m.id))
    const merged = [...newMsgs, ...existing]
    chatStorage.setSessionMessages(sessionId, merged)
  },

  removeSessionMessages(sessionId: string): void {
    Taro.removeStorageSync(msgKey(sessionId))
    const cached = getCachedSessionIds().filter((id) => id !== sessionId)
    setCachedSessionIds(cached)
  },

  // ── Current session ID ───────────────────────────────────

  getCurrentSessionId(): string | null {
    try {
      return Taro.getStorageSync(KEYS.CURRENT) || null
    } catch {
      return null
    }
  },

  setCurrentSessionId(id: string | null): void {
    if (id) {
      Taro.setStorageSync(KEYS.CURRENT, id)
    } else {
      Taro.removeStorageSync(KEYS.CURRENT)
    }
  },

  // ── 清空全部（退出登录时调用，防止跨账号串状态）───────────

  clearAll(): void {
    // 先取缓存列表，再逐个删除消息 key（CACHED_LIST 删除后就拿不到了）
    const cached = getCachedSessionIds()
    cached.forEach((id) => Taro.removeStorageSync(msgKey(id)))
    Taro.removeStorageSync(KEYS.INDEX)
    Taro.removeStorageSync(KEYS.CURRENT)
    Taro.removeStorageSync(KEYS.CACHED_LIST)
    // 旧版迁移 key（migration.ts LEGACY_SESSIONS_KEY）
    Taro.removeStorageSync('chat_sessions')
  },
}
