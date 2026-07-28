import { Logger } from '@nestjs/common';
import type { IAIProvider, ProviderConfig, StreamChunk } from '@repo/types';

/**
 * Anthropic Messages API SSE streaming provider.
 *
 * NOTE: Skeleton implementation — Anthropic's API uses a different
 * request/response format than OpenAI.  Messages endpoint:
 *   POST https://api.anthropic.com/v1/messages
 *   Headers: x-api-key, anthropic-version
 *   Body: { model, messages, max_tokens, stream: true }
 *
 * SSE events: message_start, content_block_start, content_block_delta,
 *             content_block_stop, message_delta, message_stop
 */
export class AnthropicProvider implements IAIProvider {
  readonly protocol = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);

  async *streamChat(
    messages: Array<{ role: string; content: string }>,
    config: ProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const baseUrl = config.apiBaseUrl || 'https://api.anthropic.com';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

    this.logger.log(`Streaming to ${endpoint} (model=${config.apiModelName})`);

    if (!config.apiKey) {
      throw new Error('Anthropic API 需要 API Key');
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.apiModelName,
          messages,
          max_tokens: 4096,
          stream: true,
        }),
      });
    } catch (err: any) {
      const message =
        err?.cause?.code === 'ECONNREFUSED'
          ? `无法连接到 Anthropic API (连接被拒绝)`
          : `Anthropic 请求失败: ${err.message}`;
      this.logger.error(`Fetch error: ${message}`);
      throw new Error(message);
    }

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      const message = `Anthropic 返回 ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
      this.logger.error(message);
      throw new Error(message);
    }

    const reader = (response.body as any).getReader();
    if (!reader) {
      throw new Error('无法读取 Anthropic 响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          for (const chunk of this.parseSSEEvent(part)) {
            yield chunk;
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  private parseSSEEvent(raw: string): StreamChunk[] {
    const lines = raw.split('\n');
    let eventType = '';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        data += line.slice(6);
      }
    }

    if (!data.trim()) return [];

    try {
      const json = JSON.parse(data);
      return this.normalizeChunk(eventType, json);
    } catch {
      return [];
    }
  }

  private normalizeChunk(eventType: string, raw: any): StreamChunk[] {
    const chunks: StreamChunk[] = [];

    switch (eventType) {
      case 'content_block_delta':
        if (raw.delta?.text) {
          chunks.push({ type: 'text', content: raw.delta.text });
        }
        if (raw.delta?.thinking) {
          chunks.push({ type: 'thinking', content: raw.delta.thinking });
        }
        break;
      // Other event types (message_start, content_block_start, etc.)
      // are metadata — no content to emit
    }

    return chunks;
  }
}
