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

    // Check for duplicate displayName within user's custom models
    const existing = await this.userModelRepo.findOne({
      where: { userId, displayName: dto.displayName, isActive: true },
    });
    if (existing) {
      throw new ConflictException('模型名称已存在');
    }

    const modelId = `${MODEL_ID_PREFIX}${this.generateNanoid()}`;

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
    });

    return this.toResponse(model);
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
    await model.update({ isActive: false });
  }

  // ── Model Testing ───────────────────────────────────────────

  /** Test a model connection by sending a minimal chat request */
  async testModel(userId: number, dto: TestModelDto): Promise<ModelTestResult> {
    const startTime = Date.now();

    try {
      const provider = this.providerFactory.getProvider(dto.protocolType);
      const generator = provider.streamChat([{ role: 'user', content: 'Hi' }], {
        apiModelName: dto.apiModelName,
        apiKey: dto.apiKey,
        apiBaseUrl: dto.apiBaseUrl,
      });

      // Consume first chunk to verify connection
      const first = await generator.next();
      const latency = Date.now() - startTime;

      if (first.done) {
        return { available: false, latency, error: '模型返回空响应' };
      }

      // Success — generator will be GC'd; no need to explicitly
      // call .return() which may throw in Node.js ReadableStream
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
