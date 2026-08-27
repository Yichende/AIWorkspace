// ── Unified Stream Chunk ──────────────────────────────────────

export interface StreamChunk {
  type: 'text' | 'thinking'
  content: string
}

// ── Provider Configuration ────────────────────────────────────

export interface ProviderConfig {
  apiModelName: string
  apiKey?: string
  apiBaseUrl?: string
  /**
   * 强制模型输出单一合法 JSON 对象（response_format json_object 语义）。
   * 注意：当前 analysis 流程已不再使用（json_object 与 JSONL 多事件序列冲突，
   * 且 deepseek-reasoner 类模型不支持），结构化输出由模板式 System Prompt 保证。
   * 仅适用于需要单 JSON 对象的场景（chat 流程不传）。
   * - ollama: 请求体加 format: 'json'
   * - openai_compatible: 请求体加 response_format: { type: 'json_object' }
   * - anthropic: API 无原生 JSON 模式参数，忽略该开关
   */
  jsonMode?: boolean
}

// ── AI Provider Interface ─────────────────────────────────────

export interface IAIProvider {
  /** Unique protocol identifier */
  readonly protocol: string
  /** Stream chat completion as an async generator of normalized chunks */
  streamChat(
    messages: Array<{ role: string; content: string }>,
    config: ProviderConfig,
  ): AsyncGenerator<StreamChunk>
}
