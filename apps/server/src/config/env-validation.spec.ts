import {
  ENCRYPTION_KEY_ENV,
  MIN_ENCRYPTION_KEY_LENGTH,
  assertRequiredEnv,
} from './env-validation';

describe('assertRequiredEnv', () => {
  it('密钥齐全且足够长时通过', () => {
    expect(() =>
      assertRequiredEnv({
        [ENCRYPTION_KEY_ENV]: 'a'.repeat(MIN_ENCRYPTION_KEY_LENGTH),
      }),
    ).not.toThrow();
  });

  it('密钥缺失时抛错，且提示里点明变量名', () => {
    expect(() => assertRequiredEnv({})).toThrow(ENCRYPTION_KEY_ENV);
  });

  it('空字符串按缺失处理', () => {
    expect(() => assertRequiredEnv({ [ENCRYPTION_KEY_ENV]: '' })).toThrow();
  });

  it('密钥过短时抛错', () => {
    expect(() =>
      assertRequiredEnv({
        [ENCRYPTION_KEY_ENV]: 'a'.repeat(MIN_ENCRYPTION_KEY_LENGTH - 1),
      }),
    ).toThrow(/过短/);
  });

  it('报错信息说明「为什么不能用随机密钥降级」', () => {
    // 这条断言的是「提示要讲清楚后果」，避免后来者把它简化成一句泛泛的「配置错误」
    expect(() => assertRequiredEnv({})).toThrow(/无法解密|重启/);
  });
});
