import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ModelResolver } from './model-resolver.service';
import { ModelModule } from '../model/model.module';

@Module({
  imports: [
    SequelizeModule.forFeature([ChatSession, ChatMessage]),
    ModelModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ModelResolver],
  exports: [ChatService],
})
export class ChatModule {}
