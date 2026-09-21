import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { UserService } from './user.service';
import { User } from './entities/user.entity';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        // userModel 在本用例中不被调用，用空对象占位即可
        { provide: getModelToken(User), useValue: {} },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProfile', () => {
    it('映射基础字段，并把 openid/password 转成布尔标记', () => {
      const profile = service.getProfile({
        id: 7,
        username: 'alice',
        email: 'a@b.com',
        avatar: '/uploads/avatar/x.jpg',
        openid: 'wx-openid',
        password: 'hashed',
      });

      expect(profile).toEqual({
        id: 7,
        username: 'alice',
        email: 'a@b.com',
        avatar: '/uploads/avatar/x.jpg',
        wechat_bound: true,
        has_password: true,
      });
    });

    it('avatar 缺失时回退 null，openid/password 缺失时标记为 false', () => {
      const profile = service.getProfile({
        id: 1,
        username: 'bob',
        email: 'b@c.com',
      });

      expect(profile.avatar).toBeNull();
      expect(profile.wechat_bound).toBe(false);
      expect(profile.has_password).toBe(false);
    });

    it('不把 openid / password 原文透出给客户端', () => {
      const profile = service.getProfile({
        id: 1,
        username: 'bob',
        email: 'b@c.com',
        openid: 'secret-openid',
        password: 'secret-hash',
      });

      expect(profile).not.toHaveProperty('openid');
      expect(profile).not.toHaveProperty('password');
      expect(JSON.stringify(profile)).not.toContain('secret');
    });
  });
});
