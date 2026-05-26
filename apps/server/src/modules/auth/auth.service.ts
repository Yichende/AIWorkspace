import { BadRequestException, Injectable } from '@nestjs/common';

import { InjectModel } from '@nestjs/sequelize';

import { JwtService } from '@nestjs/jwt';

import * as bcrypt from 'bcryptjs';

import { User } from '../user/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,

    private jwtService: JwtService,
  ) {}

  async register(data: { username: string; email: string; password: string }) {
    const existUser = await this.userModel.findOne({
      where: {
        email: data.email,
      },
    });

    if (existUser) {
      throw new BadRequestException('邮箱已存在');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.userModel.create({
      ...data,

      password: hashedPassword,
    });

    const token = this.jwtService.sign({
      id: user.id,
    });

    return {
      user,
      token,
    };
  }

  async login(data: { email: string; password: string }) {
    const user = await this.userModel.findOne({
      where: {
        email: data.email,
      },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const isMatch = await bcrypt.compare(data.password, user.password);

    if (!isMatch) {
      throw new BadRequestException('密码错误');
    }

    const token = this.jwtService.sign({
      id: user.id,
    });

    return {
      user,
      token,
    };
  }
}
