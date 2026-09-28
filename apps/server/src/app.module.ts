import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppService } from './app.service';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { ModelModule } from './modules/model/model.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { UploadModule } from './modules/upload/upload.module';
import { buildThrottlerOptions } from './config/throttle.config';
import { resolveSqlLogging } from './config/db.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // 用 forRootAsync 而不是 forRoot：模块装饰器的参数在任何 provider 初始化
    // **之前**求值，直接读 process.env 时 .env 还没加载 —— 正是 .env.example
    // 头部警告的那类「配了但没生效」。工厂要等 ConfigService 就绪。
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildThrottlerOptions(config),
    }),

    SequelizeModule.forRoot({
      dialect: 'mysql',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadModels: true,
      synchronize: true,
      timezone: '+08:00',
      // 默认不输出 SQL。原先的 console.log 会让 worker 每 3 秒一次的轮询
      // 刷屏（实测空闲 60 秒 26 行日志全是 SQL，约 1.1 万字符），
      // 把应用日志整个顶掉。需要时在 .env 里开 DB_LOGGING=true —— 详见 config/db.config.ts
      logging: resolveSqlLogging(process.env),
    }),
    UserModule,
    AuthModule,
    ChatModule,
    ModelModule,
    AnalysisModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局限流：漏掉哪条路由都不会裸奔 —— 逐路由注册做不到这一点。
    //
    // 用库自带的 ThrottlerGuard 而不自建子类：它的默认 getTracker 已经是
    // `normalizeIp(req.ip, ipv6SubnetPrefix)`，即**按 req.ip 而不是 req.ips[0]**
    // 取键（后者在反代 append X-Forwarded-For 时是客户端可伪造的最左值），
    // 且已处理 IPv4 映射地址与 IPv6 /64 归并 —— 自建只会把这套逻辑抄错。
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
