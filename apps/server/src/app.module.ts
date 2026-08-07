import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { AppService } from './app.service';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { ModelModule } from './modules/model/model.module';
import { AnalysisModule } from './modules/analysis/analysis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
      logging: console.log,
    }),
    UserModule,
    AuthModule,
    ChatModule,
    ModelModule,
    AnalysisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
