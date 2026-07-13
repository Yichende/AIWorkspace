// ── Model defaults ───────────────────────────────────────────

/** Default AI model used for new chat sessions */
export const DEFAULT_MODEL = 'DeepSeek-R1' as const

/** Default title for new chat sessions */
export const DEFAULT_SESSION_TITLE = '新对话' as const

// ── ID generation ────────────────────────────────────────────

/** Default greeting text shown in new chat sessions */
export const GREETING_TEXT = '你好，我是一叶 AI。' as const

/** Minimum length for client-generated IDs (per server validation) */
export const ID_MIN_LENGTH = 10

/** Maximum length for client-generated IDs (per server validation) */
export const ID_MAX_LENGTH = 36
