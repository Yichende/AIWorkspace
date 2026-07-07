// ── Model defaults ───────────────────────────────────────────

/** Default AI model used for new chat sessions */
export const DEFAULT_MODEL = 'DeepSeek-R1' as const

/** Default title for new chat sessions */
export const DEFAULT_SESSION_TITLE = '新对话' as const

// ── ID generation ────────────────────────────────────────────

/** Minimum length for client-generated IDs (per server validation) */
export const ID_MIN_LENGTH = 10

/** Maximum length for client-generated IDs (per server validation) */
export const ID_MAX_LENGTH = 36
