import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserModelService } from '../model/model.service';
import { UserModel } from '../model/entities/user-model.entity';
import { getModelById } from '@repo/types';
import type { ProviderConfig } from '@repo/types';

export interface ResolvedModel {
  source: 'builtin' | 'custom';
  protocolType: string;
  config: ProviderConfig;
}

/** Env var names for built-in provider API keys */
const BUILTIN_KEY_ENV: Record<string, string> = {
  openai_compatible: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/**
 * Layer 1 of model resolution: "What model is this? What config?"
 */
@Injectable()
export class ModelResolver {
  constructor(
    private readonly userModelService: UserModelService,
    private readonly configService: ConfigService,
  ) {}

  async resolve(userId: number, modelId: string): Promise<ResolvedModel> {
    // 1. Try built-in AI_MODELS
    const builtin = getModelById(modelId);
    if (builtin) {
      return {
        source: 'builtin',
        protocolType: builtin.provider,
        config: {
          apiModelName: builtin.apiModelName ?? builtin.id,
          // 从环境变量注入内置模型的 API Key
          apiKey: this.configService.get<string>(
            BUILTIN_KEY_ENV[builtin.provider],
          ),
        },
      };
    }

    // 2. Try custom model (WHERE is_active = true)
    const custom = await this.findUserModel(userId, modelId);
    if (!custom) {
      throw new NotFoundException(`模型 "${modelId}" 不存在`);
    }

    return {
      source: 'custom',
      protocolType: custom.protocolType,
      config: {
        apiModelName: custom.apiModelName,
        apiKey: this.userModelService.decrypt(custom.encryptedApiKey),
        apiBaseUrl: custom.apiBaseUrl ?? undefined,
      },
    };
  }

  private async findUserModel(
    userId: number,
    modelId: string,
  ): Promise<UserModel | null> {
    try {
      return await this.userModelService.findById(userId, modelId);
    } catch {
      return null;
    }
  }
}
