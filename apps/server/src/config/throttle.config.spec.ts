import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL_MS,
  RATE_LIMITS,
  THROTTLE_ERROR_MESSAGE,
  buildThrottlerOptions,
} from './throttle.config';

/** 只实现 get 的最小 ConfigService 桩 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function firstThrottler(options: ReturnType<typeof buildThrottlerOptions>) {
  if (Array.isArray(options)) throw new Error('期望对象形态的配置');
  return options.throttlers[0];
}

describe('buildThrottlerOptions', () => {
  it('未配置时使用默认值', () => {
    const options = buildThrottlerOptions(configStub({}));
    expect(firstThrottler(options)).toEqual({
      name: 'default',
      limit: DEFAULT_THROTTLE_LIMIT,
      ttl: DEFAULT_THROTTLE_TTL_MS,
    });
  });

  it('环境变量覆盖默认值（来自 .env 的是字符串）', () => {
    const options = buildThrottlerOptions(
      configStub({
        THROTTLE_DEFAULT_LIMIT: '7',
        THROTTLE_DEFAULT_TTL_MS: '30000',
      }),
    );
    expect(firstThrottler(options)).toMatchObject({ limit: 7, ttl: 30000 });
  });

  it.each([
    ['abc', '非数字'],
    ['0', '零'],
    ['-3', '负数'],
    ['1.5', '小数'],
    ['  ', '纯空白'],
  ])('非法值 %s（%s）回退到默认值且不抛错', (raw) => {
    // 回退而不是抛错是有意的：限流是安全开关，宁可用默认值生效，
    // 也不要因为一个笔误让整个服务起不来（或更糟：变成无限流）
    const options = buildThrottlerOptions(
      configStub({ THROTTLE_DEFAULT_LIMIT: raw }),
    );
    expect(firstThrottler(options).limit).toBe(DEFAULT_THROTTLE_LIMIT);
  });

  it('限流文案与移动端 ERROR_COPY 逐字一致', () => {
    // 移动端 utils/api-error.ts 的 ErrorKind.RateLimited 用的是同一句话。
    // 两边不一致时，同一个 429 会在不同入口显示成两种说法。
    const options = buildThrottlerOptions(configStub({}));
    if (Array.isArray(options)) throw new Error('期望对象形态的配置');
    expect(options.errorMessage).toBe('操作过于频繁，请稍后再试');
    expect(THROTTLE_ERROR_MESSAGE).toBe('操作过于频繁，请稍后再试');
  });

  it('IPv6 按 /64 归并（不逐地址限，否则换地址即绕开）', () => {
    const options = buildThrottlerOptions(configStub({}));
    if (Array.isArray(options)) throw new Error('期望对象形态的配置');
    expect(options.ipv6SubnetPrefix).toBe(64);
  });
});

describe('RATE_LIMITS', () => {
  it('最高危的两条（注册、登录）比全局默认值更严', () => {
    for (const key of ['register', 'login'] as const) {
      expect(RATE_LIMITS[key].limit).toBeLessThan(DEFAULT_THROTTLE_LIMIT);
    }
  });

  it('refresh 比默认值宽松', () => {
    // 客户端把任何 401 当刷新信号，刷新失败会强制登出 ——
    // 这条限流过紧会把「限流」放大成「随机登出」，所以刻意给足额度
    expect(RATE_LIMITS.refresh.limit).toBeGreaterThanOrEqual(60);
  });

  it('每条限流的 limit 与 ttl 都是正整数', () => {
    for (const [name, value] of Object.entries(RATE_LIMITS)) {
      expect(Number.isInteger(value.limit)).toBe(true);
      expect(value.limit).toBeGreaterThan(0);
      expect(Number.isInteger(value.ttl)).toBe(true);
      expect(value.ttl).toBeGreaterThan(0);
      expect(name).toBeTruthy();
    }
  });
});
