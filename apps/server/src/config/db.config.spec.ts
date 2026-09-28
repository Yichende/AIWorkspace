import { Logger } from '@nestjs/common';
import {
  DB_LOGGING_ENV,
  isSqlLoggingEnabled,
  resolveSqlLogging,
} from './db.config';

describe('isSqlLoggingEnabled', () => {
  it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', ' true '])(
    '%s 视为开启',
    (raw) => {
      expect(isSqlLoggingEnabled({ [DB_LOGGING_ENV]: raw })).toBe(true);
    },
  );

  it.each(['', '   ', 'false', '0', 'no', 'off', 'anything'])(
    '%s 视为关闭',
    (raw) => {
      expect(isSqlLoggingEnabled({ [DB_LOGGING_ENV]: raw })).toBe(false);
    },
  );

  it('未配置时为关闭', () => {
    expect(isSqlLoggingEnabled({})).toBe(false);
  });
});

describe('resolveSqlLogging', () => {
  it('默认返回 false（不输出 SQL）', () => {
    // 这是本项改动的核心：默认必须是关的，否则 worker 每 3 秒一次的轮询
    // 会把应用日志整个顶掉
    expect(resolveSqlLogging({})).toBe(false);
    expect(resolveSqlLogging({ [DB_LOGGING_ENV]: 'false' })).toBe(false);
  });

  it('开启时返回一个函数（而不是 true）', () => {
    // 走 Nest 的 Logger 而非 console.log：有级别、有上下文、格式一致
    const logger = resolveSqlLogging({ [DB_LOGGING_ENV]: 'true' });
    expect(typeof logger).toBe('function');
  });

  it('开启时经 Nest Logger 以 debug 级别输出', () => {
    const spy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);

    const logger = resolveSqlLogging({ [DB_LOGGING_ENV]: 'true' });
    (logger as (sql: string) => void)('SELECT 1');

    expect(spy).toHaveBeenCalledWith('SELECT 1');
    spy.mockRestore();
  });

  it('关闭时不是函数，调用方无从输出', () => {
    expect(typeof resolveSqlLogging({})).not.toBe('function');
  });
});
