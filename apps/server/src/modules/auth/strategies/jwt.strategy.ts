import { Injectable, UnauthorizedException } from '@nestjs/common';

import { PassportStrategy } from '@nestjs/passport';

import { ExtractJwt, Strategy } from 'passport-jwt';

import { InjectModel } from '@nestjs/sequelize';

import { ConfigService } from '@nestjs/config';

import { User } from '../../user/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,

    private configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: { id: number; type?: string }) {
    // 收紧凭据维度：access 与 refresh 的 payload 形状相同，差别只在这个 type 字段。
    // 目前两把签名密钥不同（且 env-validation 强制要求不同），refresh token 的签名
    // 本来就验不过；补这条是为了在「密钥被改成相同」或「将来共用一把密钥」时
    // 仍然挡得住 —— 否则 7 天的 refresh token 可以直接当 access token 用。
    // 存量 token 一律带 type（generateTokens 两个分支各自写入），无需兼容分支。
    if (payload.type !== 'access') {
      throw new UnauthorizedException('无效的令牌类型');
    }

    const user = await this.userModel.findByPk(payload.id);

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }
}
