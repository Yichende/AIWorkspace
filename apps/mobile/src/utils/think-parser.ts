/**
 * Streaming parser for <think>...</think> tags in AI responses.
 *
 * Stateful parser that handles partial tag arrivals during streaming.
 * Used as a client-side fallback when the server SSE does not separate
 * thinking content from answer content.
 *
 * Usage:
 *   const parser = new ThinkTagParser()
 *   for (const chunk of stream) {
 *     for (const { type, content } of parser.feed(chunk)) {
 *       if (type === 'thinking') { ... } else { ... }
 *     }
 *   }
 *   parser.reset()
 */
export interface ParsedChunk {
  type: 'thinking' | 'answer'
  content: string
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export class ThinkTagParser {
  private state: 'outside' | 'inside_think' | 'after_think' = 'outside'
  private buffer = ''

  feed(chunk: string): ParsedChunk[] {
    const results: ParsedChunk[] = []
    this.buffer += chunk

    while (this.buffer.length > 0) {
      if (this.state === 'outside') {
        const thinkIdx = this.buffer.indexOf(THINK_OPEN)
        if (thinkIdx === -1) {
          // No think tag found — keep small buffer for partial tag match
          if (this.buffer.length < THINK_OPEN.length) break
          // No think tag at all — everything is answer
          results.push({ type: 'answer', content: this.buffer })
          this.buffer = ''
          break
        }
        if (thinkIdx > 0) {
          results.push({ type: 'answer', content: this.buffer.slice(0, thinkIdx) })
        }
        this.buffer = this.buffer.slice(thinkIdx + THINK_OPEN.length)
        this.state = 'inside_think'
      }

      if (this.state === 'inside_think') {
        const closeIdx = this.buffer.indexOf(THINK_CLOSE)
        if (closeIdx === -1) {
          // Partial: keep enough to cover possible </think>
          if (this.buffer.length <= THINK_CLOSE.length) break
          // Emit what we have, keep tail for possible </think> match
          const safeEnd = Math.max(0, this.buffer.length - THINK_CLOSE.length)
          if (safeEnd > 0) {
            results.push({ type: 'thinking', content: this.buffer.slice(0, safeEnd) })
            this.buffer = this.buffer.slice(safeEnd)
          }
          break
        }
        if (closeIdx > 0) {
          results.push({ type: 'thinking', content: this.buffer.slice(0, closeIdx) })
        }
        this.buffer = this.buffer.slice(closeIdx + THINK_CLOSE.length)
        this.state = 'after_think'
      }

      if (this.state === 'after_think') {
        const nextThink = this.buffer.indexOf(THINK_OPEN)
        if (nextThink === -1) {
          if (this.buffer.length > 0) {
            results.push({ type: 'answer', content: this.buffer })
            this.buffer = ''
          }
          break
        }
        if (nextThink > 0) {
          results.push({ type: 'answer', content: this.buffer.slice(0, nextThink) })
        }
        this.buffer = this.buffer.slice(nextThink + THINK_OPEN.length)
        this.state = 'inside_think'
      }
    }

    return results
  }

  /** Flush any remaining buffered content */
  flush(): ParsedChunk[] {
    const results: ParsedChunk[] = []
    if (this.buffer.length > 0) {
      results.push({
        type: this.state === 'inside_think' ? 'thinking' : 'answer',
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
