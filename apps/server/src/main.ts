import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  const logger = new Logger('Bootstrap');

  app.enableCors();

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
