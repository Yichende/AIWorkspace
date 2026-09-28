import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * 上传相关的第三方英文原文 → 中文文案。
 *
 * 为什么翻译点在这里，而不是 `instanceof MulterError`：
 * `@nestjs/platform-express` 的 `FileInterceptor` 会把 multer 抛出的
 * `MulterError` **统一改写成 Nest 异常并原样带上英文 message**
 * （`multer/interceptors/file.interceptor.js` → `multer.utils.js` 的
 * `transformException`：`LIMIT_FILE_SIZE` → `PayloadTooLargeException('File too large')`，
 * 其余 → `BadRequestException('<英文>')`）。也就是说全局过滤器根本收不到
 * MulterError —— 按 instanceof 判是够不着的死代码。
 *
 * 这张表镜像 `transformException` 用到的 multer / busboy 常量表。刻意用**原文前缀**
 * 匹配而不是「是 400/413 就一律改写」：将来有人主动抛
 * `new PayloadTooLargeException('自定义文案')` 时不该被这里吞掉。
 * 前缀匹配同时覆盖了 Nest 给带 field 的错误拼的 ` - <field>` 后缀，
 * 以及 busboy 的 `Multipart: xxx` 形态。
 *
 * 兜底行为：漏配（multer 将来新增错误码）只会回退到英文原文，与今天一致，
 * 不会让请求失败 —— 所以这张表可以安全地不完整。
 */
const UPLOAD_EN_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['File too large', '文件大小超出上限'],
  ['Too many parts', '上传内容过多'],
  ['Too many files', '上传文件过多'],
  ['Too many fields', '上传字段过多'],
  ['Field name too long', '上传字段名过长'],
  ['Field value too long', '上传字段值过长'],
  ['Unexpected field', '上传字段不合法'],
  ['Field name missing', '上传字段名缺失'],
  // busboy（malformed multipart）
  ['Multipart:', '上传请求格式不正确'],
  ['Malformed part header', '上传请求格式不正确'],
  ['Unexpected end of form', '上传请求不完整'],
  ['Unexpected end of file', '上传文件不完整'],
];

/**
 * 把 multipart 相关的英文文案换成中文；不是已知的第三方原文就原样返回。
 *
 * 只对 400 / 413 生效：这两个状态码才是上传被拒的形态，其余状态码（401/403/404…）
 * 带着业务中文文案，不该被这张表碰到。
 */
function translateUploadMessage(status: number, raw: string): string {
  if (
    status !== HttpStatus.BAD_REQUEST &&
    status !== HttpStatus.PAYLOAD_TOO_LARGE
  ) {
    return raw;
  }
  for (const [prefix, zh] of UPLOAD_EN_MESSAGES) {
    if (raw.startsWith(prefix)) return zh;
  }
  return raw;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    let status: number;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      message =
        typeof resp === 'string'
          ? resp
          : (resp as any).message || exception.message;

      if (Array.isArray(message)) {
        message = message.join('; ');
      }

      // 上传被拒时，上面的 message 是 multer 的英文原文（Nest 改写异常时原样透传）
      const translated = translateUploadMessage(status, message);
      if (translated !== message) {
        this.logger.warn(
          `上传被拒绝 ${req.method} ${req.originalUrl}: ${message}`,
        );
        message = translated;
      }
    } else if (
      exception instanceof Error &&
      (exception as any).type === 'entity.too.large'
    ) {
      // Express body-parser PayloadTooLargeError — return proper 413
      status = (exception as any).status || HttpStatus.PAYLOAD_TOO_LARGE;
      message = '请求体过大，请减少上传数据量';
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message || 'Internal server error';

      // 只有真正的未知异常才在这里记录详情
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.originalUrl}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    }

    res.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  }
}
