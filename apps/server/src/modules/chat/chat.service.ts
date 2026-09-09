import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import {
  DEFAULT_SESSION_TITLE,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from '@repo/constants';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatSession)
    private sessionModel: typeof ChatSession,
    @InjectModel(ChatMessage)
    private messageModel: typeof ChatMessage,
    private sequelize: Sequelize,
  ) {}

  // ── Sessions ──────────────────────────────────────────────

  async listSessions(
    userId: number,
    page = DEFAULT_PAGE,
    limit = DEFAULT_PAGE_SIZE,
    keyword?: string,
  ) {
    const offset = (page - 1) * limit;
    const { rows, count } = await this.sessionModel.findAndCountAll({
      where: {
        userId,
        ...(keyword ? { title: { [Op.like]: `%${keyword}%` } } : {}),
      },
      attributes: [
        'id',
        'title',
        'model',
        'messageCount',
        'created_at',
        'updated_at',
      ],
      order: [['updated_at', 'DESC']],
      offset,
      limit,
    });

    return {
      items: rows.map((s) => ({
        id: s.id,
        title: s.title,
        model: s.model,
        messageCount: s.messageCount,
        createdAt: (s as any).created_at?.getTime?.() ?? (s as any).created_at,
        updatedAt: (s as any).updated_at?.getTime?.() ?? (s as any).updated_at,
      })),
      total: count,
      page,
      limit,
    };
  }

  async createSession(userId: number, dto: CreateSessionDto) {
    const transaction = await this.sequelize.transaction();
    try {
      const session = await this.sessionModel.create(
        {
          id: dto.id,
          userId,
          title: dto.title ?? DEFAULT_SESSION_TITLE,
          model: dto.model,
          messageCount: dto.messages?.length ?? 0,
        },
        { transaction },
      );

      if (dto.messages && dto.messages.length > 0) {
        await this.messageModel.bulkCreate(
          dto.messages.map((m) => ({
            id: m.id,
            sessionId: dto.id,
            role: m.role,
            blocks: m.blocks,
            status: m.status ?? 'success',
            createdAt: m.createdAt ?? Date.now(),
          })),
          { transaction },
        );
      }

      await transaction.commit();
      return session;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async deleteSession(userId: number, sessionId: string) {
    const session = await this.sessionModel.findByPk(sessionId);
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('无权操作此会话');
    }

    // Cascade delete messages
    await this.messageModel.destroy({ where: { sessionId } });
    await session.destroy();
    return { success: true };
  }

  async updateSession(
    userId: number,
    sessionId: string,
    dto: { title?: string; model?: string },
  ) {
    const session = await this.sessionModel.findByPk(sessionId);
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('无权操作此会话');
    }

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    // 会话中途切换模型时同步到服务端，避免重启后服务端索引
    // （仍为创建时模型）覆盖本地已切换的模型
    if (dto.model !== undefined) updateData.model = dto.model;

    await session.update(updateData);
    return session;
  }

  // ── Messages ──────────────────────────────────────────────

  async listMessages(
    userId: number,
    sessionId: string,
    before?: number,
    limit = DEFAULT_PAGE_SIZE,
  ) {
    // Verify ownership
    const session = await this.sessionModel.findByPk(sessionId);
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('无权访问此会话');
    }

    const where: any = { sessionId };
    if (before) {
      where.createdAt = { [Op.lt]: before };
    }

    const messages = await this.messageModel.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: limit + 1, // fetch one extra to determine hasMore
    });

    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(0, limit) : messages;

    // Return oldest-first
    result.reverse();

    return {
      messages: result.map((m) => ({
        id: m.id,
        role: m.role,
        blocks: m.blocks,
        status: m.status,
        createdAt: m.createdAt,
      })),
      hasMore,
    };
  }

  async saveMessage(userId: number, sessionId: string, dto: CreateMessageDto) {
    // Verify ownership
    const session = await this.sessionModel.findByPk(sessionId);
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('无权操作此会话');
    }

    // Upsert: create or update on duplicate key
    await this.messageModel.upsert({
      id: dto.id,
      sessionId,
      role: dto.role,
      blocks: dto.blocks,
      status: dto.status ?? 'success',
      createdAt: dto.createdAt ?? Date.now(),
    });

    // Update message count on session
    const totalMessages = await this.messageModel.count({
      where: { sessionId },
    });
    await this.sessionModel.update(
      { messageCount: totalMessages },
      { where: { id: sessionId } },
    );

    return { id: dto.id };
  }

  async updateMessage(
    userId: number,
    messageId: string,
    dto: UpdateMessageDto,
  ) {
    const message = await this.messageModel.findByPk(messageId, {
      include: [ChatSession],
    });
    if (!message) {
      throw new NotFoundException('消息不存在');
    }
    if (message.session.userId !== userId) {
      throw new ForbiddenException('无权操作此消息');
    }

    const updateData: any = {};
    if (dto.blocks !== undefined) updateData.blocks = dto.blocks;
    if (dto.status !== undefined) updateData.status = dto.status;

    await message.update(updateData);
    return message;
  }
}
