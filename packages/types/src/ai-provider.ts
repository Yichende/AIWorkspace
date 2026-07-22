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
