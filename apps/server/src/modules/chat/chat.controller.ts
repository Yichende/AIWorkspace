import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../user/entities/user.entity';
import { ChatService } from './chat.service';
import { ModelResolver } from './model-resolver.service';
import { ProviderFactory } from './providers/provider-factory.service';
import { StreamAbortedError, isStreamAborted } from './providers/stream-abort';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { ThinkTagParser } from '@repo/analysis-parser';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly modelResolver: ModelResolver,
    private readonly providerFactory: ProviderFactory,
  ) {}

  // ── Sessions ──────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() user: User, @Query() query: QuerySessionsDto) {
    return this.chatService.listSessions(
      user.id,
      query.page,
      query.limit,
      query.keyword?.trim(),
    );
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
    @Req() req: Request,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // 立刻提交响应头：否则首字节要等到模型解析 + 上游首 chunk，
    // 而小程序的 networkTimeout.request 是按「等响应开始」计的
    res.flushHeaders();

    const abortCtl = new AbortController();
    let aborted = false;

    // 断连后所有写入都变 no-op：socket 已经没了，写进去只会抛 ERR_STREAM_WRITE_AFTER_END
    const safeWrite = (chunk: string) => {
      if (aborted || res.writableEnded || res.destroyed) return;
      try {
        res.write(chunk);
      } catch {
        // socket 已断
      }
    };

    // SSE helper: prefix every line with "data: " so newlines in the
    // payload don't break the SSE frame.
    const sseWrite = (event: string, data: string) => {
      const encoded = data.replace(/\n/g, '\ndata: ');
      safeWrite(`event: ${event}\ndata: ${encoded}\n\n`);
    };

    // 注释帧心跳（`: ping`）：防小程序/反代把长时间无数据的连接判死。
    // 走注释而非 event，保证它永远不携带数据、被两端解析器安全忽略。
    //
    // 前提：每次写出的都是**完整帧**（含结尾 \n\n）。客户端解析器把注释当普通
    // 一行处理，若与未收尾的 data 行相邻会被并进去、污染正文 —— 之所以安全，
    // 是因为 res.write 的写入顺序即字节顺序，心跳只会落在帧与帧之间。
    // 客户端侧有对应断言：tests/sse.test.ts「服务端心跳注释帧」。
    const heartbeat = setInterval(() => safeWrite(': ping\n\n'), 15_000);

    // 'close' 在正常结束时也会触发，用 writableEnded 区分
    req.on('close', () => {
      if (res.writableEnded) return;
      aborted = true;
      abortCtl.abort(new StreamAbortedError('client disconnected'));
    });

    try {
      // Layer 1: Resolve model → protocol type + config
      const resolved = await this.modelResolver.resolve(user.id, body.model);

      // Layer 2: Get the right provider for this protocol
      const provider = this.providerFactory.getProvider(resolved.protocolType);

      // Layer 3: Stream chat via AsyncGenerator<StreamChunk>
      // content 中的 <think> 标签由 ThinkTagParser 剥离（与 analysis 队列一致），
      // 否则思考内容会以 <think>...</think> 文本形式混入正文。
      const thinkParser = new ThinkTagParser();
      for await (const chunk of provider.streamChat(
        body.messages,
        resolved.config,
        { signal: abortCtl.signal },
      )) {
        // 原生 thinking 字段（reasoning_content / delta.thinking 等）直接透传
        if (chunk.type === 'thinking') {
          sseWrite('thinking', chunk.content);
          continue;
        }
        // 普通 content：剥离 <think> 标签后按类型分发
        for (const part of thinkParser.feed(chunk.content)) {
          sseWrite(
            part.type === 'thinking' ? 'thinking' : 'content',
            part.content,
          );
        }
      }
      // Flush 流式残余（未闭合的 <think> 按 thinking 处理）
      for (const part of thinkParser.flush()) {
        sseWrite(
          part.type === 'thinking' ? 'thinking' : 'content',
          part.content,
        );
      }
      sseWrite('done', '');
    } catch (err: any) {
      // 客户端已断开时不再尝试写 error 帧（没人听）
      if (!aborted && !isStreamAborted(err)) {
        sseWrite('error', err.message || 'Stream error');
      }
    } finally {
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        // 已销毁
      }
    }
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
