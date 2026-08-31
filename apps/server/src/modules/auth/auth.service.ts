import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Op } from 'sequelize';
import { User } from '../user/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,

    @InjectModel(RefreshToken)
    private refreshTokenModel: typeof RefreshToken,

    private jwtService: JwtService,

    private configService: ConfigService,
  ) {}

  async register(data: {
    username: string;
    email: string;
    password: string;
    device_type?: string;
    device_name?: string;
    device_id?: string;
  }) {
    const existUser = await this.userModel.findOne({
      where: { email: data.email },
    });

    if (existUser) {
      throw new BadRequestException('邮箱已存在');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.userModel.create({
      username: data.username,
      email: data.email,
      password: hashedPassword,
    });

    const device_id = data.device_id || crypto.randomUUID();
    const tokens = this.generateTokens(user.id, device_id);

    await this.upsertRefreshToken(
      user.id,
      tokens.refresh_token,
      device_id,
      data.device_type,
      data.device_name,
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar ?? null,
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async login(data: {
    email: string;
    password: string;
    device_type?: string;
    device_name?: string;
    device_id?: string;
  }) {
    const user = await this.userModel.findOne({
      where: { email: data.email },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const isMatch = await bcrypt.compare(data.password, user.password);

    if (!isMatch) {
      throw new BadRequestException('密码错误');
    }

    const device_id = data.device_id || crypto.randomUUID();
    const tokens = this.generateTokens(user.id, device_id);

    await this.upsertRefreshToken(
      user.id,
      tokens.refresh_token,
      device_id,
      data.device_type,
      data.device_name,
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar ?? null,
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async refreshToken(rawRefreshToken: string) {
    let payload: { id: number; type: string; device_id: string };

    try {
      payload = this.jwtService.verify(rawRefreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('无效的令牌类型');
    }

    const record = await this.refreshTokenModel.findOne({
      where: {
        user_id: payload.id,
        device_id: payload.device_id,
      },
    });

    if (!record) {
      throw new UnauthorizedException('会话不存在或已被撤销');
    }

    const isMatch = await bcrypt.compare(rawRefreshToken, record.token_hash);

    if (!isMatch) {
      // Replay attack detected — delete the compromised record
      await record.destroy();
      throw new UnauthorizedException('刷新令牌已被使用，请重新登录');
    }

    // Generate new token pair and UPDATE the record (rotation)
    const tokens = this.generateTokens(payload.id, payload.device_id);
    const newHash = await bcrypt.hash(tokens.refresh_token, 10);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await record.update({
      token_hash: newHash,
      expires_at: newExpiresAt,
      last_used_at: new Date(),
    });

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async getSessions(userId: number, currentDeviceId?: string) {
    const records = await this.refreshTokenModel.findAll({
      where: { user_id: userId },
      order: [['last_used_at', 'DESC']],
    });

    return records.map((r) => ({
      id: r.id,
      device_type: r.device_type,
      device_name: r.device_name,
      device_id: r.device_id,
      ip_address: r.ip_address,
      last_used_at: r.last_used_at,
      created_at: r.createdAt,
      is_current: currentDeviceId ? r.device_id === currentDeviceId : false,
    }));
  }

  /**
   * 修改密码：校验旧密码、禁止新旧相同，更新后撤销全部 refresh token
   * （客户端需清除本地登录态并重新登录）。
   */
  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.userModel.findByPk(userId);
    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const isOldMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isOldMatch) {
      throw new BadRequestException('旧密码错误');
    }

    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      throw new BadRequestException('新密码不能与旧密码相同');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

    // 撤销全部设备的 refresh token，强制重新登录
    await this.revokeAllSessions(userId);

    return { success: true };
  }

  async revokeSession(userId: number, tokenId: number) {
    const record = await this.refreshTokenModel.findOne({
      where: { id: tokenId, user_id: userId },
    });

    if (record) {
      await record.destroy();
    }
  }

  async revokeAllSessions(userId: number, exceptTokenId?: number) {
    // const where: any = { user_id: userId };

    if (exceptTokenId) {
      await this.refreshTokenModel.destroy({
        where: { user_id: userId, id: { [Op.ne]: exceptTokenId } },
      });
    } else {
      await this.refreshTokenModel.destroy({ where: { user_id: userId } });
    }
  }

  // ── Private helpers ──────────────────────────────────────────

  private generateTokens(userId: number, device_id: string) {
    const accessPayload = { id: userId, type: 'access' };
    const refreshPayload = { id: userId, type: 'refresh', device_id };

    const accessExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';

    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const access_token = this.jwtService.sign(accessPayload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: accessExpiresIn as any,
    });

    const refresh_token = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn as any,
    });

    return { access_token, refresh_token };
  }

  private async upsertRefreshToken(
    userId: number,
    refreshToken: string,
    device_id: string,
    device_type?: string,
    device_name?: string,
  ) {
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const existing = await this.refreshTokenModel.findOne({
      where: { user_id: userId, device_id },
    });

    if (existing) {
      await existing.update({
        token_hash: tokenHash,
        device_type: device_type || existing.device_type,
        device_name: device_name || existing.device_name,
        expires_at: expiresAt,
        last_used_at: new Date(),
      });
    } else {
      await this.refreshTokenModel.create({
        token_hash: tokenHash,
        user_id: userId,
        device_type: device_type || 'unknown',
        device_name: device_name || 'Unknown Device',
        device_id,
        expires_at: expiresAt,
        last_used_at: new Date(),
      });
    }
  }
}
