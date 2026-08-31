import { create } from 'zustand'
import Taro from '@tarojs/taro'
import { DEFAULT_MODEL } from '@repo/constants'

// ── Storage keys ────────────────────────────────────────────
// settings_ 前缀不在 utils/cache.ts 的清理白名单（tmp_/img_/draft_）内，
// "清除缓存"不会误删；偏好为设备本地，退出登录不重置

const KEYS = {
  DEFAULT_MODEL: 'settings_default_model',
  SHOW_THINKING: 'settings_show_thinking',
} as const

// ── Helpers ──────────────────────────────────────────────────

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = Taro.getStorageSync(key)
    if (value === '' || value === undefined || value === null) {
      return fallback
    }
    return value as T
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    Taro.setStorageSync(key, value)
  } catch {
    // 存储失败忽略（不影响内存状态）
  }
}

// ── State + Actions ──────────────────────────────────────────

interface SettingsState {
  /** 用户设置的默认模型；不存在/非法时回退系统 DEFAULT_MODEL */
  defaultModel: string
  /** 是否显示思考过程（聊天与分析页的 thinking 块） */
  showThinking: boolean
  setDefaultModel: (model: string) => void
  setShowThinking: (show: boolean) => void
  /** 校验 defaultModel 是否仍在模型列表中；不在则回退系统默认并更新 storage */
  ensureDefaultModelValid: (models: { id: string }[]) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const storedModel = readStorage<string>(KEYS.DEFAULT_MODEL, '')
  const storedThinking = readStorage<boolean>(KEYS.SHOW_THINKING, true)

  return {
    defaultModel: storedModel && storedModel.trim() ? storedModel : DEFAULT_MODEL,
    showThinking: typeof storedThinking === 'boolean' ? storedThinking : true,

    setDefaultModel: (model) => {
      const valid = model && model.trim() ? model.trim() : DEFAULT_MODEL
      writeStorage(KEYS.DEFAULT_MODEL, valid)
      set({ defaultModel: valid })
    },

    setShowThinking: (show) => {
      writeStorage(KEYS.SHOW_THINKING, show)
      set({ showThinking: show })
    },

    ensureDefaultModelValid: (models) => {
      const { defaultModel } = get()
      if (!models.some((m) => m.id === defaultModel)) {
        get().setDefaultModel(DEFAULT_MODEL)
      }
    },
  }
})
