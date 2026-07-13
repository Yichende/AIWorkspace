import type { StreamCallback } from '@repo/types';

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * Parses Ollama NDJSON streaming response into normalized StreamCallback calls.
 *
 * Ollama NDJSON format (stream=true):
 *   {"message":{"thinking":"..."}}  — native thinking field (Ollama 0.5+)
 *   {"message":{"content":"..."}}   — may contain <think> tags as fallback
 *   {"done":true}                   — stream complete
 *
 * Strategy: accumulate all content text in a buffer, then extract
 * <think>...</think> blocks using simple indexOf scanning. This handles
 * tags split across multiple NDJSON chunks.
 */
export class OllamaParser {
  private buffer = '';
  private fullThink = '';
  private fullContent = '';
  private thinkReached = false; // have we seen the opening <think>?
  private thinkDone = false; // have we seen the closing </think>?
  private totalContentLen = 0; // how much of buffer has been emitted

  feedLine(line: string, cb: StreamCallback): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let chunk: any;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      return;
    }

    // ── Native thinking field (Ollama 0.5+) ──
    if (chunk.message?.thinking) {
      const raw: string = chunk.message.thinking;
      // Ollama may send either the full accumulated thinking text
      // or an incremental delta depending on version / model.
      // Detect by checking whether the new text extends what we already have.
      if (raw.startsWith(this.fullThink)) {
        const delta = raw.slice(this.fullThink.length);
        if (delta) {
          this.fullThink = raw;
          cb.onThinking?.(delta);
        }
      } else {
        // Not a prefix extension — treat as delta directly
        this.fullThink += raw;
        cb.onThinking?.(raw);
      }
      this.thinkDone = true; // native thinking → no <think> tags in content
      return;
    }

    // ── Content field ──
    if (chunk.message?.content) {
      this.buffer += chunk.message.content;
      this.flushBuffer(cb);
      return;
    }

    // ── Stream done ──
    if (chunk.done) {
      // Flush any remaining buffer
      this.flushRemaining(cb);
      cb.onDone(this.fullContent);
    }
  }

  /**
   * Scan the accumulated buffer for <think>...</think> blocks.
   * Emits thinking content via onThinking, answer content via onContent.
   * Handles partial tags by only emitting content before the last
   * incomplete tag boundary.
   */
  private flushBuffer(cb: StreamCallback): void {
    if (this.thinkDone) {
      // All subsequent content is answer
      const newContent = this.buffer.slice(this.totalContentLen);
      if (newContent) {
        this.fullContent += newContent;
        cb.onContent?.(newContent);
      }
      this.totalContentLen = this.buffer.length;
      return;
    }

    // Scan for <think> opening tag
    const openIdx = this.buffer.indexOf(THINK_OPEN);

    if (openIdx === -1) {
      // No <think> tag yet. But only emit if we have enough content
      // to be confident the tag isn't partially in the buffer tail.
      const safeLen = Math.max(0, this.buffer.length - (THINK_OPEN.length - 1));
      if (safeLen > this.totalContentLen) {
        const chunk = this.buffer.slice(this.totalContentLen, safeLen);
        // If no think tag at all, this is answer content
        if (!this.thinkReached) {
          this.fullContent += chunk;
          cb.onContent?.(chunk);
        }
        this.totalContentLen = safeLen;
      }
      return;
    }

    // Found <think> — emit any content before it as answer
    if (openIdx > this.totalContentLen) {
      const before = this.buffer.slice(this.totalContentLen, openIdx);
      this.fullContent += before;
      cb.onContent?.(before);
    }
    this.thinkReached = true;
    this.totalContentLen = openIdx + THINK_OPEN.length;

    // Look for closing </think>
    const closeIdx = this.buffer.indexOf(THINK_CLOSE, this.totalContentLen);

    if (closeIdx === -1) {
      // Closing tag not found yet — emit all available thinking content
      // Keep a tail buffer in case </think> is split across chunks
      const safeLen = Math.max(
        this.totalContentLen,
        this.buffer.length - (THINK_CLOSE.length - 1),
      );
      if (safeLen > this.totalContentLen) {
        const thinking = this.buffer.slice(this.totalContentLen, safeLen);
        this.fullThink += thinking;
        cb.onThinking?.(thinking);
        this.totalContentLen = safeLen;
      }
      return;
    }

    // Found </think> — emit thinking content between tags
    if (closeIdx > this.totalContentLen) {
      const thinking = this.buffer.slice(this.totalContentLen, closeIdx);
      this.fullThink += thinking;
      cb.onThinking?.(thinking);
    }
    this.totalContentLen = closeIdx + THINK_CLOSE.length;
    this.thinkDone = true;

    // Emit any content after </think> as answer
    if (this.buffer.length > this.totalContentLen) {
      const answer = this.buffer.slice(this.totalContentLen);
      this.fullContent += answer;
      cb.onContent?.(answer);
      this.totalContentLen = this.buffer.length;
    }
  }

  /** Emit any remaining un-emitted buffer content */
  private flushRemaining(cb: StreamCallback): void {
    if (this.buffer.length > this.totalContentLen) {
      const remaining = this.buffer.slice(this.totalContentLen);
      if (this.thinkReached && !this.thinkDone) {
        // Still inside think block — emit as thinking
        this.fullThink += remaining;
        cb.onThinking?.(remaining);
      } else {
        this.fullContent += remaining;
        cb.onContent?.(remaining);
      }
      this.totalContentLen = this.buffer.length;
    }
  }
}
