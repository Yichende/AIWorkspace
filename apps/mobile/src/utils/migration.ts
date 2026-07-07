import Taro from '@tarojs/taro'
import { chatStorage } from '@/stores/storage/chat'
import type { SessionIndexItem } from '@/services/chat.api'
import type { ChatSession } from '@/stores/chat.store'

const LEGACY_SESSIONS_KEY = 'chat_sessions'
const LEGACY_CURRENT_KEY = 'chat_current_session'
const MIGRATION_FLAG = 'chat_migration_done'

/**
 * Migrate legacy single-key storage to new split-key storage.
 * Idempotent — runs once, then never again.
 */
export function migrateLegacyData(): boolean {
  try {
    // Already migrated
    if (Taro.getStorageSync(MIGRATION_FLAG)) {
      return false
    }

    const legacyData: ChatSession[] | null =
      Taro.getStorageSync(LEGACY_SESSIONS_KEY)

    if (!legacyData || !Array.isArray(legacyData) || legacyData.length === 0) {
      // Nothing to migrate, but mark as done so we don't check again
      Taro.setStorageSync(MIGRATION_FLAG, true)
      return false
    }

    // 1. Extract session index (metadata only, no messages)
    const index: SessionIndexItem[] = legacyData
      .map((s) => ({
        id: s.id,
        title: s.title,
        model: s.model,
        messageCount: s.messages?.length ?? 0,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }))
      .slice(0, 50)

    chatStorage.setSessionsIndex(index)

    // 2. Extract recent messages for the 5 most recently updated sessions
    const recent = [...legacyData]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5)

    for (const s of recent) {
      if (s.messages && s.messages.length > 0) {
        const recentMsgs = s.messages.slice(-20) // last 20 messages
        chatStorage.setSessionMessages(s.id, recentMsgs)
      }
    }

    // 3. Preserve current session ID
    const currentId: string | null =
      Taro.getStorageSync(LEGACY_CURRENT_KEY) || null
    if (currentId) {
      chatStorage.setCurrentSessionId(currentId)
    }

    // 4. Remove legacy keys (but keep the current session ID key name
    //    since it's the same across old and new format)
    Taro.removeStorageSync(LEGACY_SESSIONS_KEY)

    // 5. Mark migration done
    Taro.setStorageSync(MIGRATION_FLAG, true)

    console.log(
      `[migration] Migrated ${index.length} sessions from legacy storage`,
    )
    return true
  } catch (err) {
    console.warn('[migration] Legacy data migration failed:', err)
    return false
  }
}
