import { Logger } from '@nestjs/common';
import type { IAIProvider, ProviderConfig, StreamChunk } from '@repo/types';

/**
 * OpenAI-compatible SSE streaming provider.
 *
 * Handles any API that follows the OpenAI chat completions format
 * (DeepSeek, Qwen, Groq, together.ai, etc.).
 *
 * normalizeChunk() handles vendor-specific field differences:
 *   - OpenAI:       delta.content
 *   - DeepSeek:     delta.content + delta.reasoning_content
 *   - Qwen:         delta.content + delta.reasoning_content
 */
export class OpenAICompatibleProvider implements IAIProvider {
  readonly protocol = 'openai_compatible';
  private readonly logger = new Logger(OpenAICompatibleProvider.name);

  // ── Public API ──────────────────────────────────────────────

  async *streamChat(
    messages: Array<{ role: string; content: string }>,
    config: ProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const endpoint = this.buildEndpoint(
      config.apiBaseUrl ?? 'https://api.openai.com/v1',
    );
    const aborter = new AbortController();

    this.logger.log(`Streaming to ${endpoint} (model=${config.apiModelName})`);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: config.apiModelName,
          messages,
          stream: true,
        }),
        signal: aborter.signal,
      });
    } catch (err: any) {
      const message =
        err?.cause?.code === 'ECONNREFUSED'
          ? `无法连接到 ${endpoint} (连接被拒绝)`
          : `请求失败: ${err.message}`;
      this.logger.error(`Fetch error: ${message}`);
      throw new Error(message);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = `API 返回 ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
      this.logger.error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error('无响应流');
    }

    const reader = (response.body as any).getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on double newline (SSE message boundary)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          for (const chunk of this.parseSSELines(part)) {
            yield chunk;
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        for (const chunk of this.parseSSELines(buffer)) {
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock?.();
      aborter.abort();
    }
  }

  // ── SSE Parsing ─────────────────────────────────────────────

  private parseSSELines(raw: string): StreamChunk[] {
    const lines = raw.split('\n');
    let data = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        data += line.slice(6);
      } else if (line.startsWith('data:')) {
        data += line.slice(5);
      }
    }

    if (!data.trim()) return [];
    if (data.trim() === '[DONE]') return [];

    try {
      const json = JSON.parse(data);
      return this.normalizeChunk(json);
    } catch {
      return [];
    }
  }

  // ── normalizeChunk ──────────────────────────────────────────

  /**
   * Convert vendor-specific raw chunk to normalized StreamChunk[].
   *
   * Handles:
   *   OpenAI:  choices[0].delta.content
   *   DeepSeek: choices[0].delta.content + choices[0].delta.reasoning_content
   *   Qwen:    choices[0].delta.content + choices[0].delta.reasoning_content
   */
  private normalizeChunk(raw: any): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    const delta = raw.choices?.[0]?.delta;
    if (!delta) return chunks;

    // Reasoning / thinking content (DeepSeek, Qwen)
    if (delta.reasoning_content) {
      chunks.push({ type: 'thinking', content: delta.reasoning_content });
    }

    // Regular text content
    if (delta.content) {
      chunks.push({ type: 'text', content: delta.content });
    }

    return chunks;
  }

  // ── buildEndpoint ───────────────────────────────────────────

  /**
   * Auto-append /v1/chat/completions, avoiding double /v1.
   *
   * "https://api.deepseek.com"          → ".../v1/chat/completions"
   * "https://api.deepseek.com/v1"       → ".../v1/chat/completions"
   * "https://api.openai.com/v1/chat/completions" → kept as-is
   */
  private buildEndpoint(base: string): string {
    const url = base.replace(/\/+$/, ''); // strip trailing slashes
    if (url.endsWith('/v1/chat/completions')) return url;
    if (url.endsWith('/v1')) return `${url}/chat/completions`;
    return `${url}/v1/chat/completions`;
  }
}
