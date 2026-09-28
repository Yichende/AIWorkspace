import * as bcrypt from 'bcryptjs';
import { hashRefreshToken, verifyRefreshToken } from './refresh-token-hash';

/** 造一个与真实 refresh token 同形态（JWT 三段、约 262 字符）的字符串 */
function fakeJwt(id: number, jti: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      id,
      type: 'refresh',
      device_id: 'ed3a1bd1-1204-4daa-9dd7-d01e17da5588',
      jti,
      iat: 1790582564,
      exp: 1791187364,
    }),
  ).toString('base64url');
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.SIGNATUREPART-${jti}`;
}

describe('hashRefreshToken', () => {
  it('产出 64 位 hex（而不是 bcrypt 串）', () => {
    const h = hashRefreshToken('some-token');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同输入得到相同摘要（确定性）', () => {
    expect(hashRefreshToken('t')).toBe(hashRefreshToken('t'));
  });

  it('不同输入得到不同摘要', () => {
    expect(hashRefreshToken('a')).not.toBe(hashRefreshToken('b'));
  });
});

describe('verifyRefreshToken', () => {
  it('匹配时返回 true', () => {
    const token = fakeJwt(9014, 'jti-a');
    expect(verifyRefreshToken(token, hashRefreshToken(token))).toBe(true);
  });

  it('不匹配时返回 false', () => {
    const token = fakeJwt(9014, 'jti-a');
    const other = fakeJwt(9014, 'jti-b');
    expect(verifyRefreshToken(other, hashRefreshToken(token))).toBe(false);
  });

  it('空 / null 摘要返回 false 而不是抛错', () => {
    expect(verifyRefreshToken('t', null)).toBe(false);
    expect(verifyRefreshToken('t', undefined)).toBe(false);
    expect(verifyRefreshToken('t', '')).toBe(false);
  });

  it('历史行里的 bcrypt 串（长度不同）安全地判否，而不是抛错', () => {
    // timingSafeEqual 要求两个 Buffer 等长，长度不等必须先挡掉
    expect(verifyRefreshToken('t', '$2b$10$abcdefghijklmnopqrstuv')).toBe(
      false,
    );
  });

  describe('72 字节截断回归（这是曾经的真实缺陷）', () => {
    it('仅 jti 不同、前 72 字节完全相同的两个 token 必须被区分开', () => {
      const a = fakeJwt(9014, 'jti-aaaaaaaa');
      const b = fakeJwt(9014, 'jti-bbbbbbbb');

      // 前提：两者前 72 字节确实相同，差异在 72 字节之后
      expect(a.slice(0, 72)).toBe(b.slice(0, 72));
      expect(a).not.toBe(b);

      expect(verifyRefreshToken(a, hashRefreshToken(a))).toBe(true);
      expect(verifyRefreshToken(b, hashRefreshToken(a))).toBe(false);
    });

    it('对照：同样的输入用 bcrypt 会判为「同一个」（所以当时没救）', async () => {
      // 这条用例把缺陷本身固化下来：如果将来有人想改回 bcrypt，
      // 它会立刻指出 bcrypt 无法区分这两个 token
      const a = fakeJwt(9014, 'jti-aaaaaaaa');
      const b = fakeJwt(9014, 'jti-bbbbbbbb');
      const bcryptHash = await bcrypt.hash(a, 4); // 低 cost 只为跑得快

      expect(await bcrypt.compare(b, bcryptHash)).toBe(true);
    });
  });
});
