import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UserModel } from './entities/user-model.entity';
import { ModelController } from './model.controller';
import { UserModelService } from './model.service';
import { ProviderFactory } from '../chat/providers/provider-factory.service';
import { OllamaProvider } from '../chat/providers/ollama.provider';
import { OpenAICompatibleProvider } from '../chat/providers/openai-compatible.provider';
import { AnthropicProvider } from '../chat/providers/anthropic.provider';

@Module({
  imports: [SequelizeModule.forFeature([UserModel])],
  controllers: [ModelController],
  providers: [
    UserModelService,
    ProviderFactory,
    OllamaProvider,
    OpenAICompatibleProvider,
    AnthropicProvider,
  ],
  exports: [UserModelService, ProviderFactory],
})
export class ModelModule {}
