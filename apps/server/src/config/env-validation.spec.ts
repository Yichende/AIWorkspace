import {
  ENCRYPTION_KEY_ENV,
  JWT_ACCESS_EXPIRES_ENV,
  JWT_REFRESH_EXPIRES_ENV,
  JWT_REFRESH_SECRET_ENV,
  JWT_SECRET_ENV,
  MIN_ENCRYPTION_KEY_LENGTH,
  MIN_JWT_SECRET_LENGTH,
  assertRequiredEnv,
} from './env-validation';

/** 一份「全部必需项都合规」的环境，单个用例只覆写自己关心的那一个键 */
function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    [ENCRYPTION_KEY_ENV]: 'a'.repeat(MIN_ENCRYPTION_KEY_LENGTH),
    [JWT_SECRET_ENV]: 'a'.repeat(MIN_JWT_SECRET_LENGTH),
    [JWT_REFRESH_SECRET_ENV]: 'b'.repeat(MIN_JWT_SECRET_LENGTH),
    [JWT_ACCESS_EXPIRES_ENV]: '15m',
    [JWT_REFRESH_EXPIRES_ENV]: '7d',
    ...overrides,
  };
}

describe('assertRequiredEnv', () => {
  it('密钥齐全且足够长时通过', () => {
    expect(() => assertRequiredEnv(validEnv())).not.toThrow();
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

describe('assertRequiredEnv 的 JWT 密钥校验', () => {
  it('JWT_SECRET 缺失时抛错，且提示里点明变量名', () => {
    expect(() =>
      assertRequiredEnv(validEnv({ [JWT_SECRET_ENV]: undefined })),
    ).toThrow(JWT_SECRET_ENV);
  });

  it('JWT_REFRESH_SECRET 缺失时抛错，且提示里点明变量名', () => {
    expect(() =>
      assertRequiredEnv(validEnv({ [JWT_REFRESH_SECRET_ENV]: undefined })),
    ).toThrow(JWT_REFRESH_SECRET_ENV);
  });

  it('空字符串按缺失处理', () => {
    expect(() => assertRequiredEnv(validEnv({ [JWT_SECRET_ENV]: '' }))).toThrow(
      JWT_SECRET_ENV,
    );
  });

  it.each([JWT_SECRET_ENV, JWT_REFRESH_SECRET_ENV])(
    '%s 短 1 位时抛错',
    (name) => {
      expect(() =>
        assertRequiredEnv(
          validEnv({ [name]: 'x'.repeat(MIN_JWT_SECRET_LENGTH - 1) }),
        ),
      ).toThrow(/过短/);
    },
  );

  it('两把密钥相同时抛错，并说明「refresh 可当 access 用」的后果', () => {
    const same = 'c'.repeat(MIN_JWT_SECRET_LENGTH);
    expect(() =>
      assertRequiredEnv(
        validEnv({ [JWT_SECRET_ENV]: same, [JWT_REFRESH_SECRET_ENV]: same }),
      ),
    ).toThrow(/不能相同/);
    // 后果必须讲清楚：这正是 P2-6 要防的那条链
    expect(() =>
      assertRequiredEnv(
        validEnv({ [JWT_SECRET_ENV]: same, [JWT_REFRESH_SECRET_ENV]: same }),
      ),
    ).toThrow(/refresh token/);
  });

  it('过短的密钥提示里给出生成命令', () => {
    expect(() =>
      assertRequiredEnv(
        validEnv({ [JWT_SECRET_ENV]: 'x'.repeat(MIN_JWT_SECRET_LENGTH - 1) }),
      ),
    ).toThrow(/randomBytes/);
  });

  it('缺失的密钥提示里说明「第一次请求才炸」这个排查难点', () => {
    expect(() =>
      assertRequiredEnv(validEnv({ [JWT_SECRET_ENV]: undefined })),
    ).toThrow(/第一次带 token 的请求/);
  });

  it.each([JWT_ACCESS_EXPIRES_ENV, JWT_REFRESH_EXPIRES_ENV])(
    '%s 取值无法解析时抛错',
    (name) => {
      expect(() => assertRequiredEnv(validEnv({ [name]: '1month' }))).toThrow(
        /无法解析/,
      );
    },
  );

  it('时长串留空时不报错（由各自的兜底默认值接手）', () => {
    expect(() =>
      assertRequiredEnv(
        validEnv({
          [JWT_ACCESS_EXPIRES_ENV]: undefined,
          [JWT_REFRESH_EXPIRES_ENV]: undefined,
        }),
      ),
    ).not.toThrow();
  });

  it('时长写成裸数字时抛错（ms 与 jsonwebtoken 的解释差 1000 倍）', () => {
    expect(() =>
      assertRequiredEnv(validEnv({ [JWT_REFRESH_EXPIRES_ENV]: '604800' })),
    ).toThrow(/无法解析/);
  });
});
