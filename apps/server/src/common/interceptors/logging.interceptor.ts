import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { Styles } from '../logger/colors';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { method, originalUrl } = req;
    const startTime = Date.now();

    // 请求入口
    const body =
      Object.keys(req.body || {}).length > 0
        ? Styles.dim(` | ${JSON.stringify(req.body)}`)
        : '';

    this.logger.log(`${Styles.method(method)} ${originalUrl}${body}`);

    return next.handle().pipe(
      tap(() => {
        const elapsed = Date.now() - startTime;
        const statusCode = res.statusCode;
        const timeStr = Styles.dim(`${elapsed}ms`);

        if (statusCode >= 500) {
          // 服务端错误
          this.logger.error(
            `${Styles.error('✗ ERR')}     ${Styles.method(method)} ${originalUrl}  ${Styles.error(String(statusCode))}  ${timeStr}`,
          );
        } else if (statusCode >= 400) {
          // 客户端错误
          this.logger.warn(
            `${Styles.warn('⚠ WARN')}    ${Styles.method(method)} ${originalUrl}  ${Styles.warn(String(statusCode))}  ${timeStr}`,
          );
        } else if (statusCode >= 300) {
          // 重定向
          this.logger.log(
            `${Styles.method(method)} ${originalUrl}  ${statusCode}  ${timeStr}`,
          );
        } else {
          // 成功 2xx
          this.logger.log(
            `${Styles.success('✓ SUCCESS')} ${Styles.method(method)} ${originalUrl}  ${Styles.success(String(statusCode))}  ${timeStr}`,
          );
        }
      }),
      catchError((err) => {
        const elapsed = Date.now() - startTime;
        const timeStr = Styles.dim(`${elapsed}ms`);

        // 提取状态码和错误信息
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        const resp = err instanceof HttpException ? err.getResponse() : null;
        const msg =
          typeof resp === 'string'
            ? resp
            : (resp as any)?.message || err?.message || 'Unknown error';
        const errMsg = Array.isArray(msg) ? msg.join(', ') : msg;

        if (statusCode >= 500) {
          this.logger.error(
            `${Styles.error('✗ ERR')}     ${Styles.method(method)} ${originalUrl}  ${Styles.error(String(statusCode))}  ${timeStr}  ${Styles.dim(`"${errMsg}"`)}`,
          );
        } else {
          this.logger.warn(
            `${Styles.warn('⚠ WARN')}    ${Styles.method(method)} ${originalUrl}  ${Styles.warn(String(statusCode))}  ${timeStr}  ${Styles.dim(`"${errMsg}"`)}`,
          );
        }

        // 重新抛出让 NestJS 正常处理
        throw err;
      }),
    );
  }
}
