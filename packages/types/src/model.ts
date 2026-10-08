// ── Built-in Models ───────────────────────────────────────────

/** Builtin provider keys — must match ProtocolType for ProviderFactory routing */
export type BuiltinProvider = 'ollama' | 'openai_compatible' | 'anthropic'

export interface AIModel {
  /** Display name shown in UI */
  id: string
  /** Which protocol handles this model (must match ProtocolType) */
  provider: BuiltinProvider
  /** Whether this model emits reasoning/thinking content */
  supportsThinking: boolean
  /** Optional: default API model name (if different from id) */
  apiModelName?: string
}

// ── Model Registry ────────────────────────────────────────────

export const AI_MODELS: AIModel[] = [
  {
    id: 'Qwen2.5-1.5B',
    provider: 'ollama',
    // Qwen2.5 非推理模型，不产出 thinking 内容
    supportsThinking: false,
    apiModelName: 'qwen2.5:1.5b',
  },
]

/** Lookup helper */
export function getModelById(id: string): AIModel | undefined {
  return AI_MODELS.find(m => m.id === id)
}

// ── Custom Model Protocol Types ───────────────────────────────

export type ProtocolType = 'openai_compatible' | 'ollama' | 'anthropic'

// ── Frontend Model List Item (no sensitive fields) ────────────

export interface ModelListItem {
  /** Unique identifier: builtin uses display name, custom uses custom_model_xxx */
  id: string
  /** Display name shown in UI */
  displayName: string
  /** Protocol type (custom models only) */
  protocolType?: ProtocolType
  /** Provider/vendor name (user-filled, custom models only) */
  provider?: string
  /** Whether this model emits reasoning/thinking content */
  supportsThinking: boolean
  /** Source: builtin constant or user-created custom model */
  source: 'builtin' | 'custom'
  /** 上次连接测试结果：null = 未测试，true = 可用，false = 不可用 */
  lastTestAvailable?: boolean | null
}
