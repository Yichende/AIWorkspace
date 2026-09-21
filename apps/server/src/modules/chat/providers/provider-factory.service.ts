import { Injectable } from '@nestjs/common';
import { OllamaProvider } from './ollama.provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AnthropicProvider } from './anthropic.provider';
import type { IAbortableProvider } from './stream-abort';

/**
 * Routes a protocol_type string to the correct provider instance.
 *
 * Layer 2 of the three-layer model resolution:
 *   ModelResolver → ProviderFactory → IAIProvider
 *
 * 返回的是服务端子接口 IAbortableProvider（= IAIProvider + 可选的中止/超时参数），
 * 因此控制器可以把客户端断开信号透传进上游；只用 2 参调用 streamChat 的地方
 * （如 model.service 的连接测试）无需改动。
 */
@Injectable()
export class ProviderFactory {
  constructor(
    private readonly ollamaProvider: OllamaProvider,
    private readonly openAICompatProvider: OpenAICompatibleProvider,
    private readonly anthropicProvider: AnthropicProvider,
  ) {}

  getProvider(protocolType: string): IAbortableProvider {
    switch (protocolType) {
      case 'ollama':
        return this.ollamaProvider;
      case 'openai_compatible':
        return this.openAICompatProvider;
      case 'anthropic':
        return this.anthropicProvider;
      default:
        throw new Error(`Unsupported protocol type: ${protocolType}`);
    }
  }

  /** Check if a protocol type string is valid */
  isValidProtocol(protocolType: string): boolean {
    return ['ollama', 'openai_compatible', 'anthropic'].includes(protocolType);
  }
}
