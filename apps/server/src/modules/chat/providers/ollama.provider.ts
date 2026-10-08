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
  /** 预生成的 Basic 凭据（OLLAMA_USERNAME / OLLAMA_PASSWORD），未配置时为 null */
  private readonly basicAuth: string | null;
  /** defaultBaseUrl 的 origin，凭据是否携带由它比对得出 */
  private readonly defaultOrigin: string | null;

  constructor() {
    // 键名与 .env / .env.example 保持一致（此前读的是 OLLAMA_HOST，
    // 而配置文件里写的是 OLLAMA_BASE_URL，两者从未对上 —— 该配置实际一直没生效）。
    // 注意 OLLAMA_HOST 在 Ollama 生态里是「服务端监听地址」，用作客户端基地址有歧义。
    this.defaultBaseUrl =
      process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.defaultOrigin = toOrigin(this.defaultBaseUrl);

    // 反代凭据（Nginx auth_basic）：用户名密码来自 apache2-utils 生成的 htpasswd。
    // 两者必须同时存在才启用 —— 只有其一多半是漏填，带上半个凭据只会让上游一直 401。
    const username = process.env.OLLAMA_USERNAME;
    const password = process.env.OLLAMA_PASSWORD;
    this.basicAuth =
      username && password
        ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
        : null;

    // 「基地址指向反代域名、却忘了配凭据」是部署时最容易漏的一步，
    // 表现出来是运行期一个 HTML 401；不如启动时就说清楚。
    if (
      !this.basicAuth &&
      this.defaultOrigin &&
      !isLoopbackOrigin(this.defaultOrigin)
    ) {
      this.logger.warn(
        `OLLAMA_BASE_URL (${this.defaultBaseUrl}) 不是本机地址，但未配置 ` +
          `OLLAMA_USERNAME / OLLAMA_PASSWORD。若该端点启用了 Basic 认证` +
          `（Nginx auth_basic），请求将被 401 拒绝。`,
      );
    }
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
    // 凭据只在目标与 OLLAMA_BASE_URL 同源时携带，见 resolveAuthHeader
    const authorization = this.resolveAuthHeader(baseUrl);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
        },
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

        // 401/403 基本都是反代（Nginx auth_basic）拦下的：此时 body 是一段 HTML，
        // 沿用通用分支打印，看起来像是「Ollama 自己报错」，排查方向会跑偏。
        if (response.status === 401 || response.status === 403) {
          const hint = authorization
            ? 'OLLAMA_USERNAME / OLLAMA_PASSWORD 可能不正确。'
            : '目标端点要求认证：若启用了 Nginx auth_basic，请在 apps/server/.env ' +
              '配置 OLLAMA_USERNAME / OLLAMA_PASSWORD（凭据仅在 baseUrl 与 ' +
              'OLLAMA_BASE_URL 同源时才会携带）。';
          const message = `Ollama 端点拒绝访问（${response.status}）：${hint}`;
          this.logger.error(message);
          throw new Error(message);
        }

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

  // ── Auth (reverse-proxy Basic) ──────────────────────────────

  /**
   * 目标与 `OLLAMA_BASE_URL` 同源时才返回 Basic 凭据。
   *
   * 自定义模型允许用户填任意 apiBaseUrl —— 若无条件附带凭据，Ollama 的口令
   * 就会被发往用户填的第三方 host（凭据外泄）。同源比对是这里唯一的防线，
   * 所以不能简化成「配了用户名密码就带上」。
   */
  private resolveAuthHeader(baseUrl: string): string | null {
    if (!this.basicAuth || !this.defaultOrigin) return null;
    return toOrigin(baseUrl) === this.defaultOrigin ? this.basicAuth : null;
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

// ── Helpers ───────────────────────────────────────────────────

/** URL 的 origin；解析失败返回 null（宁可漏带凭据，也不误发） */
function toOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** 本机地址判断：远端基地址缺凭据时用于启动告警 */
function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    );
  } catch {
    // 解析不了就不告警，交给请求期去报错
    return true;
  }
}
