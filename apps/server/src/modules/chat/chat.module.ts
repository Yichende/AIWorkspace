import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AiProviderFactory } from './providers/ai-provider.factory';
import { OllamaService } from './providers/ollama/ollama.service';

@Module({
  imports: [SequelizeModule.forFeature([ChatSession, ChatMessage])],
  controllers: [ChatController],
  providers: [ChatService, OllamaService, AiProviderFactory],
  exports: [ChatService],
})
export class ChatModule {}
