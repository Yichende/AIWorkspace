// ── Stream Callbacks ──────────────────────────────────────────

export interface StreamCallback {
  onThinking?(text: string): void
  onContent?(text: string): void
  onDone(fullText: string): void
  onError?(error: string): void
}

// ── Chat Request ──────────────────────────────────────────────

export interface ChatRequest {
  model: string
  messages: Array<{ role: string; content: string }>
}

// ── AI Provider Interface ─────────────────────────────────────

export interface IAIProvider {
  /** Unique provider identifier */
  readonly name: string
  /** Check if this provider handles the given model */
  supports(model: string): boolean
  /** Stream chat completion, calling callbacks as chunks arrive */
  streamChat(params: ChatRequest, callback: StreamCallback): Promise<void>
}
