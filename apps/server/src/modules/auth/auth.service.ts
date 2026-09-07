import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import { User } from '../user/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
      user: this.serializeUser(user),
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

    const pwd = user.password;

    if (!pwd) {
      // 微信一键注册的账号无密码，请走微信登录（或用设置密码补齐）
      throw new BadRequestException('该账号未设置密码，请使用微信登录');
    }

    const isMatch = await bcrypt.compare(data.password, pwd);

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
      user: this.serializeUser(user),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  // ── 微信登录 / 绑定 ─────────────────────────────────────────

  /**
   * 微信一键登录：code2session 换 openid。已存在 → 直接登录；
   * 不存在 → 自动建号（无邮箱/密码，可在个人页用「设置密码」补齐）。
   */
  async wechatLogin(data: {
    code: string;
    device_type?: string;
    device_name?: string;
    device_id?: string;
  }) {
    const { openid } = await this.code2session(data.code);

    let user = await this.userModel.findOne({ where: { openid } });

    if (!user) {
      // username 无唯一约束，随机生成即可（无需重试）
      const username = `微信用户${Math.floor(100000 + Math.random() * 900000)}`;
      try {
        user = await this.userModel.create({
          username,
          email: null,
          password: null,
          openid,
        });
      } catch (err) {
        // 仅 openid 唯一冲突（并发首次登录撞号）才回退复用已建账号；
        // email 等其他唯一冲突/未知错误原样抛出，绝不误判
        if (!this.isOpenidUniqueViolation(err)) {
          throw err;
        }
        user = await this.userModel.findOne({ where: { openid } });
        if (!user) {
          throw err;
        }
      }
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
      user: this.serializeUser(user),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  /** 绑定微信：为当前账号写入 openid；该 openid 已被其他账号占用则拒绝 */
  async wechatBind(user: User, code: string) {
    const { openid } = await this.code2session(code);

    // 幂等：已绑定同一微信
    if (user.openid === openid) {
      return { success: true, wechat_bound: true };
    }
    if (user.openid) {
      throw new BadRequestException('当前账号已绑定其他微信账号');
    }

    const occupied = await this.userModel.findOne({ where: { openid } });
    if (occupied) {
      throw new BadRequestException('该微信已绑定其他账号');
    }

    try {
      await user.update({ openid });
    } catch (err) {
      // 并发兜底：两账号同时绑同一微信 → unique 冲突
      if (this.isOpenidUniqueViolation(err)) {
        throw new BadRequestException('该微信已绑定其他账号');
      }
      throw err;
    }

    return { success: true, wechat_bound: true };
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
   * 修改密码：仅对已有密码的账号可用（校验旧密码、禁止新旧相同），
   * 更新后撤销全部 refresh token（客户端需清除本地登录态并重新登录）。
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

    const pwd = user.password;
    if (!pwd) {
      throw new BadRequestException('该账号未设置密码，请使用设置密码');
    }

    const isOldMatch = await bcrypt.compare(oldPassword, pwd);
    if (!isOldMatch) {
      throw new BadRequestException('旧密码错误');
    }

    const isSameAsOld = await bcrypt.compare(newPassword, pwd);
    if (isSameAsOld) {
      throw new BadRequestException('新密码不能与旧密码相同');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

    // 撤销全部设备的 refresh token，强制重新登录
    await this.revokeAllSessions(userId);

    return { success: true };
  }

  /**
   * 设置密码：仅对尚无密码的账号（如微信一键注册）可用，不校验旧密码。
   * 成功后保留当前会话（用户正以微信登录态操作，无需强制重登）。
   */
  async setPassword(userId: number, newPassword: string) {
    const user = await this.userModel.findByPk(userId);
    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (user.password) {
      throw new BadRequestException('该账号已设置密码，请使用修改密码');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });

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

  /** 用户序列化：登录/注册/档案统一对外结构（不暴露 openid） */
  private serializeUser(user: User) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar ?? null,
      wechat_bound: !!user.openid,
      has_password: !!user.password,
    };
  }

  /** 仅当唯一约束失败指向 openid 列时才返回 true（email 等其他冲突不误判） */
  private isOpenidUniqueViolation(err: unknown): boolean {
    if (!(err instanceof UniqueConstraintError)) return false;

    const item = err.errors?.[0] as { path?: string } | undefined;
    const fieldKey = err.fields ? Object.keys(err.fields)[0] : undefined;
    if (item?.path === 'openid' || fieldKey === 'openid') return true;

    // 兜底：原生 MySQL 错误消息含 openid 索引名（uni_users_openid / users_openid）
    const sqlMessage = (err as any).original?.sqlMessage ?? '';
    return /openid/i.test(sqlMessage);
  }

  /**
   * 微信 code2session：错误细节只写服务端日志（[wechat] 前缀），
   * 对外统一中文文案，不把 errcode/errmsg 原文暴露给客户端。
   */
  private async code2session(code: string): Promise<{ openid: string }> {
    const appid = this.configService.get<string>('WECHAT_APPID');
    const secret = this.configService.get<string>('WECHAT_SECRET');

    if (!appid || !secret) {
      this.logger.error(
        '[wechat] code2session 未配置: 缺少 WECHAT_APPID/WECHAT_SECRET',
      );
      throw new ServiceUnavailableException('微信登录暂不可用，请稍后重试');
    }

    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', appid);
    url.searchParams.set('secret', secret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    let data: any;
    try {
      data = await (await fetch(url.toString())).json();
    } catch (err) {
      this.logger.error('[wechat] code2session 请求/解析异常', err);
      throw new ServiceUnavailableException('微信登录暂不可用，请稍后重试');
    }

    if (data.errcode) {
      this.logger.error(
        `[wechat] code2session 失败: errcode=${data.errcode} errmsg=${data.errmsg}`,
      );
      throw new BadRequestException('微信登录失败，请稍后重试');
    }
    if (!data.openid) {
      this.logger.error('[wechat] code2session 响应缺少 openid');
      throw new ServiceUnavailableException('微信登录暂不可用，请稍后重试');
    }

    return { openid: data.openid as string };
  }

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
