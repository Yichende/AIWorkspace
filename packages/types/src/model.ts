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
  { id: 'DeepSeek-R1', provider: 'ollama', supportsThinking: true, apiModelName: 'deepseek-r1:latest' },
  { id: 'DeepSeek-V3', provider: 'ollama', supportsThinking: false, apiModelName: 'deepseek-v3:latest' },
  { id: 'Qwen3',       provider: 'ollama', supportsThinking: true, apiModelName: 'qwen3:latest' },
  { id: 'GPT-4o',      provider: 'openai_compatible', supportsThinking: false, apiModelName: 'gpt-4o' },
  { id: 'Claude 4',    provider: 'anthropic', supportsThinking: false, apiModelName: 'claude-sonnet-4-20250514' },
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
}
