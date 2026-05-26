import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SequelizeModule } from '@nestjs/sequelize';

import { User } from '../user/entities/user.entity';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    SequelizeModule.forFeature([User]),

    JwtModule.register({
      global: true,

      secret: process.env.JWT_SECRET,

      signOptions: {
        expiresIn: '7d',
      },
    }),
  ],

  controllers: [AuthController],

  providers: [AuthService],
})
export class AuthModule {}
