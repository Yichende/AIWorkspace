import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import * as crypto from 'crypto';
import { UserModel } from './entities/user-model.entity';
import { CreateUserModelDto } from './dto/create-user-model.dto';
import { UpdateUserModelDto } from './dto/update-user-model.dto';
import { TestModelDto } from './dto/test-model.dto';
import { ProviderFactory } from '../chat/providers/provider-factory.service';
import { AI_MODELS, getModelById } from '@repo/types';
import type {
  UserModelResponse,
  ModelListItem,
  ModelTestResult,
} from '@repo/types';

const MODEL_ID_PREFIX = 'custom_model_';

@Injectable()
export class UserModelService {
  private readonly logger = new Logger(UserModelService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectModel(UserModel)
    private userModelRepo: typeof UserModel,
    private providerFactory: ProviderFactory,
  ) {
    const key = process.env.MODEL_API_KEY_ENCRYPTION_KEY;
    if (!key) {
      this.logger.warn(
        'MODEL_API_KEY_ENCRYPTION_KEY not set — API keys will NOT be encrypted!',
      );
      this.encryptionKey = crypto.randomBytes(32);
    } else {
      this.encryptionKey = crypto.scryptSync(key, 'model-salt', 32);
    }
  }

  // ── CRUD ────────────────────────────────────────────────────

  /** Get merged model list (builtin + user's custom models) */
  async getMergedModelList(userId: number): Promise<ModelListItem[]> {
    const builtins: ModelListItem[] = AI_MODELS.map((m) => ({
      id: m.id,
      displayName: m.id,
      protocolType: undefined,
      provider: m.provider,
      supportsThinking: m.supportsThinking,
      source: 'builtin' as const,
    }));

    const customs = await this.userModelRepo.findAll({
      where: { userId, isActive: true },
      order: [['created_at', 'ASC']],
    });

    const customItems: ModelListItem[] = customs.map((m) => ({
      id: m.modelId,
      displayName: m.displayName,
      protocolType: m.protocolType as ModelListItem['protocolType'],
      provider: m.provider ?? undefined,
      supportsThinking: m.supportsThinking,
      source: 'custom' as const,
    }));

    return [...builtins, ...customItems];
  }

  /** Create a new custom model */
  async create(
    userId: number,
    dto: CreateUserModelDto,
  ): Promise<UserModelResponse> {
    // Check for name collision with builtin models
    if (getModelById(dto.displayName)) {
      throw new ConflictException('模型名称与内置模型冲突，请使用其他名称');
    }

    const uniqueKey = `${userId}:${dto.displayName}`;

    // Check for duplicate active model (belt: DB unique index is the suspenders)
    const existing = await this.userModelRepo.findOne({
      where: { userId, displayName: dto.displayName, isActive: true },
    });
    if (existing) {
      throw new ConflictException('模型名称已存在');
    }

    // ── Upsert: reactivate soft-deleted record if one exists ──
    const softDeleted = await this.userModelRepo.findOne({
      where: { userId, displayName: dto.displayName, isActive: false },
    });

    if (softDeleted) {
      try {
        await softDeleted.update({
          protocolType: dto.protocolType,
          provider: dto.provider ?? null,
          apiModelName: dto.apiModelName,
          encryptedApiKey: dto.apiKey ? this.encrypt(dto.apiKey) : null,
          apiBaseUrl: dto.apiBaseUrl ?? null,
          supportsThinking: dto.supportsThinking ?? false,
          notes: dto.notes ?? null,
          isActive: true,
          uniqueKey,
        });

        await softDeleted.reload();
        return this.toResponse(softDeleted);
      } catch (err: any) {
        this.logger.error(
          `Failed to reactivate model "${dto.displayName}" for user ${userId}: ${err.message}`,
          err.stack,
        );
        if (err.name === 'SequelizeUniqueConstraintError') {
          throw new ConflictException('模型名称已存在，请重试');
        }
        throw err;
      }
    }

    // ── Fresh create ──
    const modelId = `${MODEL_ID_PREFIX}${this.generateNanoid()}`;

    try {
      const model = await this.userModelRepo.create({
        modelId,
        userId,
        displayName: dto.displayName,
        protocolType: dto.protocolType,
        provider: dto.provider ?? null,
        apiModelName: dto.apiModelName,
        encryptedApiKey: dto.apiKey ? this.encrypt(dto.apiKey) : null,
        apiBaseUrl: dto.apiBaseUrl ?? null,
        supportsThinking: dto.supportsThinking ?? false,
        notes: dto.notes ?? null,
        isActive: true,
        uniqueKey,
      });

      return this.toResponse(model);
    } catch (err: any) {
      this.logger.error(
        `Failed to create model "${dto.displayName}" for user ${userId}: ${err.message}`,
        err.stack,
      );
      if (err.name === 'SequelizeUniqueConstraintError') {
        throw new ConflictException('模型 ID 或名称已存在，请重试');
      }
      throw err;
    }
  }

  /** Get single model detail (for edit page) */
  async findById(userId: number, modelId: string): Promise<UserModel> {
    const model = await this.userModelRepo.findOne({
      where: { modelId, userId, isActive: true },
    });
    if (!model) {
      throw new NotFoundException('模型不存在');
    }
    return model;
  }

  /** Get model detail as response DTO (no apiKey exposure) */
  async getDetail(userId: number, modelId: string): Promise<UserModelResponse> {
    const model = await this.findById(userId, modelId);
    return this.toResponse(model);
  }

  /** Update a custom model */
  async update(
    userId: number,
    modelId: string,
    dto: UpdateUserModelDto,
  ): Promise<UserModelResponse> {
    const model = await this.findById(userId, modelId);

    const updateData: any = {};

    if (dto.displayName !== undefined) {
      // Check for name collision (excluding self)
      if (getModelById(dto.displayName)) {
        throw new ConflictException('模型名称与内置模型冲突');
      }
      const duplicate = await this.userModelRepo.findOne({
        where: {
          userId,
          displayName: dto.displayName,
          modelId: { [Op.ne]: modelId },
          isActive: true,
        },
      });
      if (duplicate) {
        throw new ConflictException('模型名称已存在');
      }
      updateData.displayName = dto.displayName;
      // 同步更新 uniqueKey 以匹配新的 displayName
      updateData.uniqueKey = `${userId}:${dto.displayName}`;
    }

    if (dto.provider !== undefined) updateData.provider = dto.provider || null;
    if (dto.apiModelName !== undefined)
      updateData.apiModelName = dto.apiModelName;
    if (dto.apiBaseUrl !== undefined)
      updateData.apiBaseUrl = dto.apiBaseUrl || null;
    if (dto.supportsThinking !== undefined)
      updateData.supportsThinking = dto.supportsThinking;
    if (dto.notes !== undefined) updateData.notes = dto.notes || null;

    // apiKey: empty string → keep existing; non-empty → update
    if (dto.apiKey !== undefined && dto.apiKey !== '') {
      updateData.encryptedApiKey = this.encrypt(dto.apiKey);
    }

    await model.update(updateData);
    // Reload to get fresh data
    const updated = await this.userModelRepo.findByPk(model.id);
    return this.toResponse(updated!);
  }

  /** Soft delete a custom model */
  async remove(userId: number, modelId: string): Promise<void> {
    const model = await this.findById(userId, modelId);
    await model.update({
      isActive: false,
      uniqueKey: null, // 释放唯一键，允许新建同名模型
      encryptedApiKey: null, // 安全：删除即清除凭据
    });
  }

  // ── Model Testing ───────────────────────────────────────────

  /** Test a model connection by sending a minimal chat request */
  async testModel(userId: number, dto: TestModelDto): Promise<ModelTestResult> {
    const startTime = Date.now();

    // 编辑态测试：表单未填 key 且携带 modelId → 回退使用该模型存库的解密 key。
    // 服务端按设计不回传 key（编辑页无法预填），若留空直接测试将发出无鉴权
    // 请求导致必然失败（如 DeepSeek 401 Authentication Fails）。
    // 其余场景（新建未保存/已填 key/自定义临时配置）不受影响。
    let apiKey = dto.apiKey;
    if (!apiKey && dto.modelId) {
      const stored = await this.findById(userId, dto.modelId);
      apiKey = this.decrypt(stored.encryptedApiKey);
      if (!apiKey) {
        return {
          available: false,
          latency: Date.now() - startTime,
          error: '该模型未保存有效 API Key，请在 API Key 输入框中填写后再测试',
        };
      }
    }

    try {
      const provider = this.providerFactory.getProvider(dto.protocolType);
      const generator = provider.streamChat([{ role: 'user', content: 'Hi' }], {
        apiModelName: dto.apiModelName,
        apiKey,
        apiBaseUrl: dto.apiBaseUrl,
      });

      // Consume first chunk to verify connection
      const first = await generator.next();
      const latency = Date.now() - startTime;

      if (first.done) {
        return { available: false, latency, error: '模型返回空响应' };
      }

      // Safety check: reject error-like text chunks even if the provider
      // didn't throw (belt-and-suspenders with the provider fix)
      if (
        first.value?.type === 'text' &&
        typeof first.value?.content === 'string' &&
        first.value.content.startsWith('[错误]')
      ) {
        return { available: false, latency, error: first.value.content };
      }

      // Attempt to gracefully close the underlying stream to avoid
      // resource leaks.  Swallow errors since some runtimes (Node.js
      // ReadableStream) may reject .return().
      try {
        await (generator as any).return?.();
      } catch {
        // ignore
      }

      return { available: true, latency };
    } catch (err: any) {
      const latency = Date.now() - startTime;
      return {
        available: false,
        latency,
        error: err.message || '测试连接失败',
      };
    }
  }

  // ── Encryption ──────────────────────────────────────────────

  /**
   * Encrypt plaintext using AES-256-GCM.
   * Returns base64-encoded: iv (12 bytes) + authTag (16 bytes) + ciphertext
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Format: iv + authTag + ciphertext, all base64
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  /**
   * Decrypt base64-encoded ciphertext.
   * Expects format: iv (12 bytes) + authTag (16 bytes) + ciphertext
   */
  decrypt(ciphertext: string | null): string | undefined {
    if (!ciphertext) return undefined;
    try {
      const buf = Buffer.from(ciphertext, 'base64');
      const iv = buf.subarray(0, 12);
      const authTag = buf.subarray(12, 28);
      const encrypted = buf.subarray(28);
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        iv,
      );
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      this.logger.warn('Failed to decrypt API key — key may have been rotated');
      return undefined;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private toResponse(model: UserModel): UserModelResponse {
    return {
      id: model.modelId,
      displayName: model.displayName,
      protocolType: model.protocolType as UserModelResponse['protocolType'],
      provider: model.provider ?? undefined,
      apiModelName: model.apiModelName,
      apiBaseUrl: model.apiBaseUrl ?? undefined,
      supportsThinking: model.supportsThinking,
      notes: model.notes ?? undefined,
      isActive: model.isActive,
      createdAt: model.created_at?.getTime?.() ?? Date.now(),
      // 仅告知是否存在 key（用于编辑页占位提示），绝不回传 key 本身
      hasApiKey: !!model.encryptedApiKey,
    };
  }

  /** Generate a short nanoid-like ID */
  private generateNanoid(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const bytes = crypto.randomBytes(12);
    for (let i = 0; i < 12; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }
}
