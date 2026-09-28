import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

const TEST_SECRET = 'x'.repeat(32);

/**
 * passport-jwt 在**构造期**就要求 secret 非空（否则抛
 * `JwtStrategy requires a secret or key`），所以桩必须给一个真值。
 */
function build(userModel: Record<string, any>): JwtStrategy {
  const config = {
    get: jest.fn().mockReturnValue(TEST_SECRET),
  } as unknown as ConfigService;

  return new JwtStrategy(userModel as any, config);
}

describe('JwtStrategy.validate', () => {
  it('type 为 access 且用户存在时返回用户', async () => {
    const user = { id: 1, username: 'u' };
    const userModel = { findByPk: jest.fn().mockResolvedValue(user) };
    const strategy = build(userModel);

    await expect(strategy.validate({ id: 1, type: 'access' })).resolves.toBe(
      user,
    );
    expect(userModel.findByPk).toHaveBeenCalledWith(1);
  });

  it('type 缺失时拒绝（不能因为「老 token 没带 type」就放行）', async () => {
    const userModel = { findByPk: jest.fn() };
    const strategy = build(userModel);

    await expect(strategy.validate({ id: 1 })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(userModel.findByPk).not.toHaveBeenCalled();
  });

  describe('refresh token 冒充 access token（P2-6 回归护栏）', () => {
    it('拒绝 refresh 类型', async () => {
      const userModel = { findByPk: jest.fn() };
      const strategy = build(userModel);

      await expect(
        strategy.validate({ id: 1, type: 'refresh' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('拒绝时不去查库（类型检查必须在查库之前）', async () => {
      // 顺序反了会让每次非法请求都白打一次数据库
      const userModel = { findByPk: jest.fn() };
      const strategy = build(userModel);

      await expect(
        strategy.validate({ id: 1, type: 'refresh' }),
      ).rejects.toThrow();
      expect(userModel.findByPk).not.toHaveBeenCalled();
    });

    it('报错文案明确指向「令牌类型」而不是「用户不存在」', async () => {
      const strategy = build({ findByPk: jest.fn() });

      await expect(
        strategy.validate({ id: 1, type: 'refresh' }),
      ).rejects.toThrow(/无效的令牌类型/);
    });
  });

  it('access 类型但用户不存在时抛错', async () => {
    const userModel = { findByPk: jest.fn().mockResolvedValue(null) };
    const strategy = build(userModel);

    await expect(
      strategy.validate({ id: 999, type: 'access' }),
    ).rejects.toThrow(/用户不存在/);
  });
});
