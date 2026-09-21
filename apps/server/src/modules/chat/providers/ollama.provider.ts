import { Logger } from '@nestjs/common';
import type { ProviderConfig, StreamChunk } from '@repo/types';
import {
  createStreamAbort,
  disposeReader,
  isStreamAborted,
  isStreamTimeout,
  type IAbortableProvider,
  type StreamChatOptions,
} from './stream-abort';

/**
 * Ollama NDJSON streaming provider.
 *
 * Handles both local Ollama instances and custom Ollama-compatible endpoints.
 * Uses Ollama's native /api/chat endpoint with stream=true.
 *
 * Thinking/reasoning is extracted from the native "thinking" field (Ollama 0.5+).
 * <think> tag parsing within content is delegated to the Queue-level ThinkTagParser.
 */
export class OllamaProvider implements IAbortableProvider {
  readonly protocol = 'ollama';
  private readonly logger = new Logger(OllamaProvider.name);
  private readonly defaultBaseUrl: string;

  constructor() {
    // 键名与 .env / .env.example 保持一致（此前读的是 OLLAMA_HOST，
    // 而配置文件里写的是 OLLAMA_BASE_URL，两者从未对上 —— 该配置实际一直没生效）。
    // 注意 OLLAMA_HOST 在 Ollama 生态里是「服务端监听地址」，用作客户端基地址有歧义。
    this.defaultBaseUrl =
      process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  // ── Public API ──────────────────────────────────────────────

  async *streamChat(
    messages: Array<{ role: string; content: string }>,
    config: ProviderConfig,
    options?: StreamChatOptions,
  ): AsyncGenerator<StreamChunk> {
    const baseUrl = config.apiBaseUrl || this.defaultBaseUrl;
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/chat`;

    this.logger.log(`Streaming to ${endpoint} (model=${config.apiModelName})`);

    const abort = createStreamAbort(options?.signal, options?.timeouts);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 注意：不发送 format: 'json'。
        // Ollama 的 JSON grammar 会约束包括思考阶段在内的全部生成，而 deepseek-r1
        // 等推理模型的思考是自由文本，grammar 会使其坍缩为 "{}"（已实测复现）。
        // 结构化输出改由 analysis 侧的模板式 prompt 保证。
        body: JSON.stringify({
          model: config.apiModelName,
          messages,
          stream: true,
        }),
        signal: abort.signal,
      });
    } catch (err: any) {
      // 中止 / 超时带语义，不能被下面的包装吞掉 code
      if (isStreamAborted(err) || isStreamTimeout(err)) throw err;
      const message =
        err?.cause?.code === 'ECONNREFUSED'
          ? `无法连接到 Ollama 服务 (${baseUrl})。请确保 Ollama 已启动。`
          : `Ollama 请求失败: ${err.message}`;
      this.logger.error(`Fetch error: ${message}`);
      throw new Error(message);
    }

    try {
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        const message = `Ollama 返回 ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
        this.logger.error(message);
        throw new Error(message);
      }

      const reader = (response.body as any).getReader();
      if (!reader) {
        throw new Error('无法读取 Ollama 响应流');
      }

      // 响应头已到：清 TTFB 计时器、武装 idle 计时器
      abort.headersReceived();

      const decoder = new TextDecoder();
      let leftover = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          abort.bumpIdle();

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
        await disposeReader(reader);
      }
    } finally {
      abort.dispose();
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

    // Content field: emit as text (think tags handled by Queue-level ThinkTagParser)
    if (raw.message?.content) {
      chunks.push({ type: 'text', content: raw.message.content });
    }

    return chunks;
  }
}
