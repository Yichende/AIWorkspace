import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';
import { ChatService } from './chat.service';
import { AiProviderFactory } from './providers/ai-provider.factory';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import type { StreamCallback } from '@repo/types';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly aiFactory: AiProviderFactory,
  ) {}

  // ── Sessions ──────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() user: User, @Query() query: QuerySessionsDto) {
    return this.chatService.listSessions(user.id, query.page, query.limit);
  }

  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  createSession(@CurrentUser() user: User, @Body() dto: CreateSessionDto) {
    return this.chatService.createSession(user.id, dto);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  deleteSession(@CurrentUser() user: User, @Param('id') id: string) {
    return this.chatService.deleteSession(user.id, id);
  }

  @Patch('sessions/:id')
  @UseGuards(JwtAuthGuard)
  updateSession(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.chatService.updateSession(user.id, id, dto);
  }

  // ── AI Completions (SSE) ────────────────────────────────

  @Post('completions')
  @UseGuards(JwtAuthGuard)
  async streamCompletion(
    @CurrentUser() user: User,
    @Body()
    body: { model: string; messages: Array<{ role: string; content: string }> },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // SSE helper: prefix every line with "data: " so newlines in the
    // payload don't break the SSE frame. Without this, \n in thinking
    // text would produce continuation lines that the client ignores.
    const sseWrite = (event: string, data: string) => {
      const encoded = data.replace(/\n/g, '\ndata: ');
      res.write(`event: ${event}\ndata: ${encoded}\n\n`);
    };

    const provider = this.aiFactory.getProvider(body.model);

    const callback: StreamCallback = {
      onThinking: (text) => {
        sseWrite('thinking', text);
      },
      onContent: (text) => {
        sseWrite('content', text);
      },
      onDone: (fullText) => {
        sseWrite('done', fullText);
        res.end();
      },
      onError: (err) => {
        sseWrite('error', err);
        res.end();
      },
    };

    await provider.streamChat(
      { model: body.model, messages: body.messages },
      callback,
    );
  }

  // ── Messages ──────────────────────────────────────────────

  @Get('sessions/:id/messages')
  @UseGuards(JwtAuthGuard)
  listMessages(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query() query: QueryMessagesDto,
  ) {
    return this.chatService.listMessages(
      user.id,
      id,
      query.before,
      query.limit,
    );
  }

  @Post('sessions/:id/messages')
  @UseGuards(JwtAuthGuard)
  createMessage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chatService.saveMessage(user.id, id, dto);
  }

  @Patch('messages/:id')
  @UseGuards(JwtAuthGuard)
  updateMessage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.chatService.updateMessage(user.id, id, dto);
  }
}
