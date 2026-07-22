import { Logger } from '@nestjs/common';
import type { IAIProvider, ProviderConfig, StreamChunk } from '@repo/types';

/**
 * Ollama NDJSON streaming provider.
 *
 * Handles both local Ollama instances and custom Ollama-compatible endpoints.
 * Uses Ollama's native /api/chat endpoint with stream=true.
 *
 * Thinking/reasoning is extracted from:
 *   1. Native "thinking" field (Ollama 0.5+)
 *   2. <think>...</think> tags in content (legacy fallback)
 */
export class OllamaProvider implements IAIProvider {
  readonly protocol = 'ollama';
  private readonly logger = new Logger(OllamaProvider.name);
  private readonly defaultBaseUrl: string;

  constructor() {
    this.defaultBaseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
  }

  // ── Public API ──────────────────────────────────────────────

  async *streamChat(
    messages: Array<{ role: string; content: string }>,
    config: ProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const baseUrl = config.apiBaseUrl || this.defaultBaseUrl;
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/chat`;

    this.logger.log(`Streaming to ${endpoint} (model=${config.apiModelName})`);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.apiModelName,
          messages,
          stream: true,
        }),
      });
    } catch (err: any) {
      const message =
        err?.cause?.code === 'ECONNREFUSED'
          ? `无法连接到 Ollama 服务 (${baseUrl})。请确保 Ollama 已启动。`
          : `Ollama 请求失败: ${err.message}`;
      this.logger.error(`Fetch error: ${message}`);
      yield { type: 'text', content: `[错误] ${message}` };
      return;
    }

    if (!response.ok || !response.body) {
      yield {
        type: 'text',
        content: `[错误] Ollama 返回 ${response.status}`,
      };
      return;
    }

    const reader = (response.body as any).getReader();
    if (!reader) {
      yield { type: 'text', content: '[错误] 无法读取 Ollama 响应流' };
      return;
    }

    const decoder = new TextDecoder();
    let leftover = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        leftover += decoder.decode(value, { stream: true });
        const lines = leftover.split('\n');
        leftover = lines.pop() || '';

        for (const line of lines) {
          for (const chunk of this.parseLine(line)) {
            yield chunk;
          }
        }
      }

      // Flush remaining
      if (leftover.trim()) {
        for (const chunk of this.parseLine(leftover)) {
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  // ── NDJSON Line Parsing ─────────────────────────────────────

  private parseLine(line: string): StreamChunk[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    let chunk: any;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      return [];
    }

    return this.normalizeChunk(chunk);
  }

  // ── normalizeChunk ──────────────────────────────────────────

  private normalizeChunk(raw: any): StreamChunk[] {
    const chunks: StreamChunk[] = [];

    // Native thinking field (Ollama 0.5+)
    if (raw.message?.thinking) {
      chunks.push({ type: 'thinking', content: raw.message.thinking });
    }

    // Content field (may contain <think> tags)
    if (raw.message?.content) {
      // If we already have native thinking, content is pure answer
      if (raw.message.thinking) {
        chunks.push({ type: 'text', content: raw.message.content });
      } else {
        // Parse <think> tags from content
        for (const c of this.parseThinkTags(raw.message.content)) {
          chunks.push(c);
        }
      }
    }

    return chunks;
  }

  /**
   * Extract <think>...</think> blocks from content text.
   * Content before <think> is regular text.
   * Content inside <think>...</think> is thinking.
   * Content after </think> is regular text.
   */
  private parseThinkTags(content: string): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    const THINK_OPEN = '<think>';
    const THINK_CLOSE = '</think>';

    let remaining = content;

    while (remaining.length > 0) {
      const openIdx = remaining.indexOf(THINK_OPEN);

      if (openIdx === -1) {
        // No more think tags
        if (remaining) chunks.push({ type: 'text', content: remaining });
        break;
      }

      // Content before <think>
      if (openIdx > 0) {
        chunks.push({ type: 'text', content: remaining.slice(0, openIdx) });
      }

      const thinkStart = openIdx + THINK_OPEN.length;
      const closeIdx = remaining.indexOf(THINK_CLOSE, thinkStart);

      if (closeIdx === -1) {
        // Unclosed think tag — treat rest as thinking
        chunks.push({ type: 'thinking', content: remaining.slice(thinkStart) });
        break;
      }

      // Content inside <think>...</think>
      if (closeIdx > thinkStart) {
        chunks.push({
          type: 'thinking',
          content: remaining.slice(thinkStart, closeIdx),
        });
      }

      remaining = remaining.slice(closeIdx + THINK_CLOSE.length);
    }

    return chunks;
  }
}
