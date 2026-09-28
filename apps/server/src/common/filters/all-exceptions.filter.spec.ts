import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** 造一个只够过滤器用的 ArgumentsHost 桩 */
function hostStub(): {
  host: ArgumentsHost;
  body: () => any;
  status: () => number;
} {
  const req = { method: 'POST', originalUrl: '/analysis/upload' };
  let captured: any;
  let statusCode = 0;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      captured = payload;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;

  return { host, body: () => captured, status: () => statusCode };
}

describe('AllExceptionsFilter 的上传错误脱敏', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('Nest 改写后的 multer 异常（这是实际到达过滤器的形态）', () => {
    it('LIMIT_FILE_SIZE 改写的 413：英文原文换成中文', () => {
      // FileInterceptor 把 MulterError 改写成 PayloadTooLargeException('File too large')，
      // 所以这里构造的是改写后的形态，而不是 MulterError 本身
      const { host, body, status } = hostStub();

      filter.catch(new PayloadTooLargeException('File too large'), host);

      expect(status()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(body().message).toBe('文件大小超出上限');
      expect(JSON.stringify(body())).not.toContain('File too large');
    });

    it('带 field 后缀的形态也能识别（Nest 会拼 ` - <field>`）', () => {
      const { host, body, status } = hostStub();

      filter.catch(new BadRequestException('Unexpected field - avatar'), host);

      expect(status()).toBe(HttpStatus.BAD_REQUEST);
      expect(body().message).toBe('上传字段不合法');
    });

    it('busboy 的 multipart 错误换成中文', () => {
      const { host, body } = hostStub();

      filter.catch(
        new BadRequestException('Multipart: Boundary not found'),
        host,
      );

      expect(body().message).toBe('上传请求格式不正确');
    });
  });

  describe('不误伤', () => {
    it('400 上的业务中文文案原样保留', () => {
      const { host, body } = hostStub();

      filter.catch(
        new BadRequestException('仅支持 .xlsx .xls .csv 格式'),
        host,
      );

      expect(body().message).toBe('仅支持 .xlsx .xls .csv 格式');
    });

    it('非 400/413 状态码不进入翻译表', () => {
      // 用真的 403 异常但把文案改成 multer 的原文，确认翻译只认状态码 400/413 ——
      // 否则任何一个 4xx 上恰好出现的英文都会被改写
      const { host, body, status } = hostStub();
      const forbidden = new ForbiddenException('File too large');

      filter.catch(forbidden, host);

      expect(status()).toBe(HttpStatus.FORBIDDEN);
      expect(body().message).toBe('File too large');
    });

    it('自定义的 413 文案不被改写（只认已知的第三方原文）', () => {
      const { host, body } = hostStub();

      filter.catch(new PayloadTooLargeException('导出文件过大'), host);

      expect(body().message).toBe('导出文件过大');
    });

    it('普通 Error 仍然 500 且 message 原样保留', () => {
      const { host, body, status } = hostStub();

      filter.catch(new Error('boom'), host);

      expect(status()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body().message).toBe('boom');
    });

    it('body-parser 的超限错误仍走自己的分支（中文）', () => {
      const { host, body, status } = hostStub();
      const err: any = new Error('request entity too large');
      err.type = 'entity.too.large';

      filter.catch(err, host);

      expect(status()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(body().message).toBe('请求体过大，请减少上传数据量');
    });
  });

  it('响应体结构不变（statusCode/message/timestamp/path）', () => {
    const { host, body } = hostStub();

    filter.catch(new PayloadTooLargeException('File too large'), host);

    expect(Object.keys(body()).sort()).toEqual([
      'message',
      'path',
      'statusCode',
      'timestamp',
    ]);
    expect(body().path).toBe('/analysis/upload');
  });
});
