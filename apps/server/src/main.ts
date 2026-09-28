import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { assertRequiredEnv } from './config/env-validation';
import {
  CORS_ORIGINS_ENV,
  TRUST_PROXY_HOPS_ENV,
  buildCorsOptions,
  parseCorsOrigins,
  resolveTrustProxyHops,
} from './config/http.config';
import { json, urlencoded } from 'express';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  // 启动前置校验：缺密钥就拒绝启动，不做静默降级（详见 env-validation 注释）
  assertRequiredEnv();

  // 确保头像上传目录存在（multer diskStorage 不会自动建目录）
  fs.mkdirSync(path.join(process.cwd(), 'uploads', 'avatar'), {
    recursive: true,
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  const logger = new Logger('Bootstrap');

  // 反代跳数决定 req.ip，而 req.ip 同时是限流键与 refresh_tokens.ip_address 的来源。
  // 配错会让所有用户共用一个限流桶 —— 所以只接受明确的整数，不接受 true。
  app.set(
    'trust proxy',
    resolveTrustProxyHops(process.env[TRUST_PROXY_HOPS_ENV]),
  );

  const corsOrigins = parseCorsOrigins(process.env[CORS_ORIGINS_ENV]);
  if (corsOrigins.length === 0) {
    logger.warn(
      `${CORS_ORIGINS_ENV} 未配置：CORS 仍对所有来源开放（生产环境应收敛白名单）`,
    );
  }
  // 传 undefined 等价于原来的无参 enableCors()，保持未配置时的既有行为
  app.enableCors(buildCorsOptions(corsOrigins));

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
