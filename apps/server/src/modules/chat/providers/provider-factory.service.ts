import { Injectable } from '@nestjs/common';
import type { IAIProvider } from '@repo/types';
import { OllamaProvider } from './ollama.provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AnthropicProvider } from './anthropic.provider';

/**
 * Routes a protocol_type string to the correct IAIProvider instance.
 *
 * Layer 2 of the three-layer model resolution:
 *   ModelResolver → ProviderFactory → IAIProvider
 */
@Injectable()
export class ProviderFactory {
  constructor(
    private readonly ollamaProvider: OllamaProvider,
    private readonly openAICompatProvider: OpenAICompatibleProvider,
    private readonly anthropicProvider: AnthropicProvider,
  ) {}

  getProvider(protocolType: string): IAIProvider {
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
