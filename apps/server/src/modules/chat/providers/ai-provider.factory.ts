import { Injectable } from '@nestjs/common';
import type { IAIProvider } from '@repo/types';
import { OllamaService } from './ollama/ollama.service';

/**
 * Resolves a model name to its AI provider.
 *
 * To add a new provider (e.g. OpenAI):
 * 1. Create providers/openai/openai.service.ts implementing IAIProvider
 * 2. Inject it here alongside OllamaService
 * 3. Add it to the providers array below
 *
 * The chat controller and SSE format need zero changes.
 */
@Injectable()
export class AiProviderFactory {
  private providers: IAIProvider[];

  constructor(
    ollamaService: OllamaService,
    // Add new providers here, e.g.:
    // openaiService: OpenAIService,
  ) {
    this.providers = [
      ollamaService,
      // openaiService,
    ];
  }

  getProvider(model: string): IAIProvider {
    const provider = this.providers.find((p) => p.supports(model));
    if (!provider) {
      throw new Error(`No AI provider found for model: ${model}`);
    }
    return provider;
  }
}
