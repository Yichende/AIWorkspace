import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';
import { ChatService } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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
