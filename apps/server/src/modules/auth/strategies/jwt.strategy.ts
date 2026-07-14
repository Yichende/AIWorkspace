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

  async validate(payload: { id: number }) {
    const user = await this.userModel.findByPk(payload.id);

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }
}
