import type { ThinkChunk } from './types'

// ═══════════════════════════════════════════════════════════════
// Think Tag Parser — extracts <think>...</think> from text stream
// ═══════════════════════════════════════════════════════════════

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export class ThinkTagParser {
  private state: 'outside' | 'inside' | 'after' = 'outside'
  private buffer = ''

  feed(chunk: string): ThinkChunk[] {
    const results: ThinkChunk[] = []
    this.buffer += chunk

    while (this.buffer.length > 0) {
      if (this.state === 'outside') {
        const openIdx = this.buffer.indexOf(THINK_OPEN)
        const closeIdx = this.buffer.indexOf(THINK_CLOSE)

        // No tags at all — keep buffer for partial tag match
        if (openIdx === -1 && closeIdx === -1) {
          if (this.buffer.length < THINK_OPEN.length && this.buffer.length < THINK_CLOSE.length) break
          results.push({ type: 'answer', content: this.buffer })
          this.buffer = ''
          break
        }

        // Orphan </think> without preceding <think>:
        // Some Ollama versions strip <think> but leave </think> in content.
        // Treat everything before the orphan </think> as thinking.
        if ((openIdx === -1 && closeIdx !== -1) || (closeIdx !== -1 && closeIdx < openIdx)) {
          if (closeIdx > 0) {
            results.push({ type: 'thinking', content: this.buffer.slice(0, closeIdx) })
          }
          this.buffer = this.buffer.slice(closeIdx + THINK_CLOSE.length)
          this.state = 'after'
          continue
        }

        // Normal case: <think> found first
        if (openIdx > 0) {
          results.push({ type: 'answer', content: this.buffer.slice(0, openIdx) })
        }
        this.buffer = this.buffer.slice(openIdx + THINK_OPEN.length)
        this.state = 'inside'
      }

      if (this.state === 'inside') {
        const idx = this.buffer.indexOf(THINK_CLOSE)
        if (idx === -1) {
          // 保留尾部以防 </think 被截断
          const safeEnd = Math.max(0, this.buffer.length - THINK_CLOSE.length)
          if (safeEnd > 0) {
            results.push({ type: 'thinking', content: this.buffer.slice(0, safeEnd) })
            this.buffer = this.buffer.slice(safeEnd)
          }
          break
        }
        if (idx > 0) {
          results.push({ type: 'thinking', content: this.buffer.slice(0, idx) })
        }
        this.buffer = this.buffer.slice(idx + THINK_CLOSE.length)
        this.state = 'after'
      }

      if (this.state === 'after') {
        const openIdx = this.buffer.indexOf(THINK_OPEN)
        const closeIdx = this.buffer.indexOf(THINK_CLOSE)

        // No more tags
        if (openIdx === -1 && closeIdx === -1) {
          if (this.buffer.length > 0) {
            results.push({ type: 'answer', content: this.buffer })
            this.buffer = ''
          }
          break
        }

        // Orphan </think> without preceding <think>
        if ((openIdx === -1 && closeIdx !== -1) || (closeIdx !== -1 && closeIdx < openIdx)) {
          if (closeIdx > 0) {
            results.push({ type: 'thinking', content: this.buffer.slice(0, closeIdx) })
          }
          this.buffer = this.buffer.slice(closeIdx + THINK_CLOSE.length)
          continue
        }

        // Normal case: <think> found first
        if (openIdx > 0) {
          results.push({ type: 'answer', content: this.buffer.slice(0, openIdx) })
        }
        this.buffer = this.buffer.slice(openIdx + THINK_OPEN.length)
        this.state = 'inside'
      }
    }

    return results
  }

  flush(): ThinkChunk[] {
    const results: ThinkChunk[] = []
    if (this.buffer.length > 0) {
      results.push({
        type: this.state === 'inside' ? 'thinking' : 'answer',
        content: this.buffer,
      })
      this.buffer = ''
    }
    return results
  }

  reset(): void {
    this.state = 'outside'
    this.buffer = ''
  }
}
