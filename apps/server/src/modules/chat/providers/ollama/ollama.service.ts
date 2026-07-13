import { Injectable, Logger } from '@nestjs/common';
import type { IAIProvider, ChatRequest, StreamCallback } from '@repo/types';
import { getModelById } from '@repo/types';
import { OllamaParser } from './ollama.parser';

@Injectable()
export class OllamaService implements IAIProvider {
  readonly name = 'ollama';
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
  }

  supports(model: string): boolean {
    const m = getModelById(model);
    return m?.provider === 'ollama';
  }

  async streamChat(params: ChatRequest, cb: StreamCallback): Promise<void> {
    const parser = new OllamaParser();
    const model = getModelById(params.model);
    const apiModel = model?.apiModelName ?? params.model;

    this.logger.log(
      `Starting stream: model=${apiModel}, messages=${params.messages.length}`,
    );

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: apiModel,
          messages: params.messages,
          stream: true,
          think: true, // ← Enable native thinking/reasoning field
        }),
      });

      if (!response.ok || !response.body) {
        cb.onError?.(`Ollama returned ${response.status}`);
        return;
      }

      const reader = (response.body as any).getReader();
      if (!reader) {
        cb.onError?.('No readable stream available');
        return;
      }

      const decoder = new TextDecoder();
      let leftover = '';
      let chunkCount = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        leftover += text;
        const lines = leftover.split('\n');
        leftover = lines.pop() || '';

        for (const line of lines) {
          chunkCount++;
          if (chunkCount <= 3) {
            this.logger.log(
              `Ollama chunk #${chunkCount}: ${line.slice(0, 120)}`,
            );
          }
          parser.feedLine(line, cb);
        }
      }

      // Process any remaining data
      if (leftover.trim()) {
        parser.feedLine(leftover, cb);
      }

      this.logger.log(`Stream complete: ${chunkCount} chunks received`);
    } catch (err: any) {
      this.logger.error('Ollama stream error:', err);

      // Provide helpful error messages for common issues
      let message = String(err?.message ?? err);
      if (
        err?.cause?.code === 'ECONNREFUSED' ||
        message.includes('ECONNREFUSED')
      ) {
        message = `无法连接到 Ollama 服务 (${this.baseUrl})。请确保 Ollama 已在本地启动。`;
      } else if (message.includes('fetch failed')) {
        message = `Ollama 请求失败：${message}。请检查 Ollama 服务是否正在运行 (${this.baseUrl})。`;
      }

      cb.onError?.(message);
    }
  }
}
