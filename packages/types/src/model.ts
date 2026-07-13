export type AIProvider = 'ollama' | 'openai' | 'anthropic'

export interface AIModel {
  /** Display name shown in UI */
  id: string
  /** Which provider handles this model */
  provider: AIProvider
  /** Whether this model emits reasoning/thinking content */
  supportsThinking: boolean
  /** Optional: default API model name (if different from id) */
  apiModelName?: string
}

// ── Model Registry ────────────────────────────────────────────

export const AI_MODELS: AIModel[] = [
  { id: 'DeepSeek-R1', provider: 'ollama', supportsThinking: true, apiModelName: 'deepseek-r1:latest' },
  { id: 'DeepSeek-V3', provider: 'ollama', supportsThinking: false, apiModelName: 'deepseek-v3:latest' },
  { id: 'Qwen3',       provider: 'ollama', supportsThinking: true,  apiModelName: 'qwen3:latest' },
  { id: 'GPT-4o',      provider: 'openai', supportsThinking: false },
  { id: 'Claude 4',    provider: 'anthropic', supportsThinking: false },
]

/** Lookup helper */
export function getModelById(id: string): AIModel | undefined {
  return AI_MODELS.find(m => m.id === id)
}
