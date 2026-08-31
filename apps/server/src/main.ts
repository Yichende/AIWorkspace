import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { json, urlencoded } from 'express';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  // 确保头像上传目录存在（multer diskStorage 不会自动建目录）
  fs.mkdirSync(path.join(process.cwd(), 'uploads', 'avatar'), {
    recursive: true,
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  const logger = new Logger('Bootstrap');

  app.enableCors();

  // 静态资源服务：只开放头像目录（uploads/analysis 等其他目录不暴露）
  app.useStaticAssets(path.join(process.cwd(), 'uploads', 'avatar'), {
    prefix: '/uploads/avatar/',
  });

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );

  // 全局日志拦截器 - 格式化 HTTP 请求/响应日志
  app.useGlobalInterceptors(new LoggingInterceptor());

  // 全局异常过滤器 - 统一错误日志格式
  app.useGlobalFilters(new AllExceptionsFilter());

  // 增大 body-parser的JSON限制
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  await app.listen(process.env.PORT ?? 3000);
  logger.log(
    `✓ Server running on http://localhost:${process.env.PORT ?? 3000}`,
  );
}
bootstrap();
