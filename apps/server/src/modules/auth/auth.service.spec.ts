import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Op } from 'sequelize';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { User } from '../user/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import * as tokenHash from './refresh-token-hash';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        // 只验证依赖可注入；模型与 JWT/Config 在本文件不被调用。
        // 签发/校验/刷新等真实行为由下面的 describe 用直接 new 的方式覆盖。
        { provide: getModelToken(User), useValue: {} },
        { provide: getModelToken(RefreshToken), useValue: {} },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

/**
 * P2-3：refresh token 的凭据维度加固。
 *
 * 用「直接 new + 手搓桩」的写法（与 analysis.service.spec 同风格），
 * 因为要覆盖真实行为而不是可注入性。
 */
describe('AuthService 刷新令牌加固', () => {
  let service: AuthService;
  let refreshTokenModel: any;
  let jwtService: any;
  let configService: any;
  let verifySpy: jest.SpyInstance;
  let passwordCompareSpy: jest.SpyInstance;

  const DAY_MS = 24 * 60 * 60 * 1000;
  /** 用例里当作「客户端持有的那个 refresh token」 */
  const RAW = 'raw-rt';

  /** 造一个可被 update / destroy 的会话记录（默认持有 RAW 的正确摘要） */
  const makeRecord = (over: Record<string, any> = {}) => ({
    id: 1,
    user_id: 7,
    token_hash: tokenHash.hashRefreshToken(RAW),
    device_id: 'dev-1',
    expires_at: new Date(Date.now() + 3 * DAY_MS),
    ip_address: '1.1.1.1',
    user_agent: 'old-agent',
    destroy: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  beforeEach(() => {
    refreshTokenModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((v: any) => Promise.resolve(v)),
      findAll: jest.fn().mockResolvedValue([]),
    };
    jwtService = {
      verify: jest
        .fn()
        .mockReturnValue({ id: 7, type: 'refresh', device_id: 'dev-1' }),
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
    };
    configService = {
      get: jest.fn((key: string) =>
        key === 'JWT_REFRESH_EXPIRES_IN' ? '7d' : 'x'.repeat(32),
      ),
    };

    // 摘要比较走真实实现（它现在是纯函数、够快），只在需要断言
    // 「没有发生比较」的用例里才用 spy 观察
    verifySpy = jest.spyOn(tokenHash, 'verifyRefreshToken');
    // 口令哈希仍是 bcrypt，登录用例需要
    passwordCompareSpy = jest.spyOn(bcrypt, 'compare');

    service = new AuthService(
      { findOne: jest.fn(), create: jest.fn() } as any,
      refreshTokenModel,
      jwtService,
      configService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('DB 的 expires_at 必须被校验（此前只信 JWT 自己的 exp）', () => {
    it('会话已过期 → 拒绝，且不比较 hash', async () => {
      refreshTokenModel.findOne.mockResolvedValue(
        makeRecord({ expires_at: new Date(Date.now() - 60_000) }),
      );

      await expect(service.refreshToken(RAW)).rejects.toThrow(/会话已过期/);
      // 过期会话压根不该走到摘要比较那一步
      expect(verifySpy).not.toHaveBeenCalled();
    });

    it('过期的会话**不销毁**记录（它是审计线索，不是攻击证据）', async () => {
      const record = makeRecord({ expires_at: new Date(Date.now() - 60_000) });
      refreshTokenModel.findOne.mockResolvedValue(record);

      await expect(service.refreshToken(RAW)).rejects.toThrow();
      expect(record.destroy).not.toHaveBeenCalled();
      expect(record.update).not.toHaveBeenCalled();
    });

    it('过期且摘要不匹配时，报的是「已过期」而不是「已被使用」', async () => {
      // 顺序反了就会走进重放分支：语义错，还会 destroy 掉记录
      const record = makeRecord({
        expires_at: new Date(Date.now() - 60_000),
        token_hash: tokenHash.hashRefreshToken('另一个 token'),
      });
      refreshTokenModel.findOne.mockResolvedValue(record);

      await expect(service.refreshToken(RAW)).rejects.toThrow(/会话已过期/);
      expect(record.destroy).not.toHaveBeenCalled();
    });

    it('未过期但摘要不匹配 → 重放分支：销毁记录并报「已被使用」', async () => {
      // 这条是 Postman 重放检测用例的单测镜像。
      // 注意它现在**真的**能验到：sha256 覆盖整个 token，而 bcrypt 只看前
      // 72 字节时，这两个 token 会被判成同一个（见 refresh-token-hash.spec）
      const record = makeRecord({
        token_hash: tokenHash.hashRefreshToken('轮转后的新 token'),
      });
      refreshTokenModel.findOne.mockResolvedValue(record);

      await expect(service.refreshToken(RAW)).rejects.toThrow(/已被使用/);
      expect(record.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('过期时长由配置推导（此前硬编码两处 7 天）', () => {
    const setTtl = (value: string | undefined) =>
      configService.get.mockImplementation((key: string) =>
        key === 'JWT_REFRESH_EXPIRES_IN' ? value : 'x'.repeat(32),
      );

    it('轮转时写入的 expires_at 跟随 JWT_REFRESH_EXPIRES_IN', async () => {
      setTtl('1d');
      const record = makeRecord();
      refreshTokenModel.findOne.mockResolvedValue(record);

      const before = Date.now();
      await service.refreshToken(RAW);

      const { expires_at } = record.update.mock.calls[0][0];
      const ttl = expires_at.getTime() - before;
      expect(ttl).toBeGreaterThan(DAY_MS - 5000);
      expect(ttl).toBeLessThan(DAY_MS + 5000);
    });

    it('配置缺省时仍是 7 天（向后兼容）', async () => {
      setTtl(undefined);
      const record = makeRecord();
      refreshTokenModel.findOne.mockResolvedValue(record);

      const before = Date.now();
      await service.refreshToken(RAW);

      const { expires_at } = record.update.mock.calls[0][0];
      const ttl = expires_at.getTime() - before;
      expect(ttl).toBeGreaterThan(7 * DAY_MS - 5000);
      expect(ttl).toBeLessThan(7 * DAY_MS + 5000);
    });
  });

  describe('指纹写入（ip_address 此前全仓无写入点）', () => {
    /** 造一个能走到「首次写入」分支的 login 调用 */
    const loginWith = async (
      userModel: any,
      params: Record<string, any>,
    ): Promise<any> => {
      passwordCompareSpy.mockResolvedValue(true);
      const svc = new AuthService(
        userModel as any,
        refreshTokenModel,
        jwtService,
        configService,
      );
      await svc.login({ email: 'e', password: 'p', ...params });
      return refreshTokenModel.create.mock.calls[0][0];
    };

    const existingUser = {
      findOne: jest.fn().mockResolvedValue({
        id: 7,
        username: 'u',
        password: 'hashed',
        openid: null,
      }),
    };

    it('登录时写入 IP 与 UA', async () => {
      const values = await loginWith(existingUser, {
        ip_address: '203.0.113.9',
        user_agent: 'WeChat/8.0',
      });

      expect(values.ip_address).toBe('203.0.113.9');
      expect(values.user_agent).toBe('WeChat/8.0');
    });

    it('缺失指纹时写 null 而不是空串', async () => {
      // 空串在会话列表里会渲染成空白行；null 才能让前端区分「未知」
      const values = await loginWith(existingUser, {});

      expect(values.ip_address).toBeNull();
      expect(values.user_agent).toBeNull();
    });

    it('login 的 data 对象里带 ip_address 时不会污染写库字段', async () => {
      const values = await loginWith(existingUser, {
        ip_address: '203.0.113.9',
        user_agent: 'UA',
      });

      // 只该出现这两个指纹字段，不该把整个 data 摊进 create
      expect(Object.keys(values).sort()).toEqual(
        expect.arrayContaining([
          'device_id',
          'device_name',
          'device_type',
          'expires_at',
          'ip_address',
          'last_used_at',
          'token_hash',
          'user_agent',
          'user_id',
        ]),
      );
      expect(values.email).toBeUndefined();
      expect(values.password).toBeUndefined();
    });

    it('UA 超长时截断到 512（否则 MySQL 严格模式会直接报错）', async () => {
      const record = makeRecord();
      refreshTokenModel.findOne.mockResolvedValue(record);

      await service.refreshToken(RAW, { user_agent: 'A'.repeat(900) });

      const { user_agent } = record.update.mock.calls[0][0];
      expect(user_agent).toHaveLength(512);
    });

    it('rotating 时携带指纹会更新记录，缺失时保留旧值', async () => {
      const record = makeRecord();
      refreshTokenModel.findOne.mockResolvedValue(record);

      // 带指纹 → 更新
      await service.refreshToken(RAW, { ip_address: '198.51.100.7' });
      expect(record.update.mock.calls[0][0].ip_address).toBe('198.51.100.7');

      // 不带指纹 → 不写该字段（保留旧值，不能把已有指纹抹成空）
      record.update.mockClear();
      await service.refreshToken(RAW, {});
      expect(record.update.mock.calls[0][0]).not.toHaveProperty('ip_address');
      expect(record.update.mock.calls[0][0]).not.toHaveProperty('user_agent');
    });
  });

  describe('轮转必须真的换掉 token', () => {
    /**
     * JWT 的 iat 只有秒级精度，refresh 负载若没有随机成分，同一秒内签发的
     * 两个 token 会逐字节相同 —— 轮转就成了原地踏步。实测确认过 RT1 === RT2。
     *
     * 注意：光有 jti 还不够 —— 摘要必须覆盖**整个** token，否则（用 bcrypt 时）
     * 前 72 字节相同的两个 token 依旧无法区分。这两件事各自的护栏分别在
     * 本用例与 refresh-token-hash.spec 里。
     */
    const captureRefreshPayloads = async (
      times: number,
    ): Promise<Array<Record<string, any>>> => {
      refreshTokenModel.findOne.mockResolvedValue(makeRecord());

      for (let i = 0; i < times; i++) {
        await service.refreshToken(RAW);
      }

      // generateTokens 每次都调两次 sign（access + refresh），只挑 refresh
      return jwtService.sign.mock.calls
        .map((c: any[]) => c[0])
        .filter((p: any) => p.type === 'refresh');
    };

    it('每次签发都带一个不同的 jti', async () => {
      const payloads = await captureRefreshPayloads(2);

      expect(payloads).toHaveLength(2);
      expect(payloads[0].jti).toBeTruthy();
      expect(payloads[1].jti).toBeTruthy();
      // 这才是关键：两个 jti 不同 ⇒ 两个 token 不同 ⇒ 轮转真的换了凭据
      expect(payloads[0].jti).not.toBe(payloads[1].jti);
    });

    it('jti 不参与鉴权字段（id / type / device_id 保持不变）', async () => {
      const payloads = await captureRefreshPayloads(1);

      expect(payloads[0]).toMatchObject({
        id: 7,
        type: 'refresh',
        device_id: 'dev-1',
      });
    });

    it('access 负载不加 jti（它不需要唯一性，且改它没有收益）', async () => {
      await captureRefreshPayloads(1);

      const accessPayloads = jwtService.sign.mock.calls
        .map((c: any[]) => c[0])
        .filter((p: any) => p.type === 'access');

      expect(accessPayloads.length).toBeGreaterThan(0);
      expect(accessPayloads[0].jti).toBeUndefined();
    });
  });

  describe('getSessions', () => {
    it('where 里带上 expires_at > now（过期会话不该留在设备列表里）', async () => {
      refreshTokenModel.findAll.mockResolvedValue([]);

      await service.getSessions(7);

      const { where } = refreshTokenModel.findAll.mock.calls[0][0];
      expect(where.user_id).toBe(7);
      expect(where.expires_at[Op.gt]).toBeInstanceOf(Date);
      expect(where.expires_at[Op.gt].getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('透出 user_agent', async () => {
      refreshTokenModel.findAll.mockResolvedValue([
        makeRecord({ user_agent: 'SomeUA/1.0' }),
      ]);

      const sessions = await service.getSessions(7);

      expect(sessions[0].user_agent).toBe('SomeUA/1.0');
    });
  });
});
