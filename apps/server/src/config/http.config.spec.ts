import {
  buildCorsOptions,
  parseCorsOrigins,
  resolveTrustProxyHops,
} from './http.config';

/** 把回调式 origin 判定收成一次同步调用，便于断言 */
function checkOrigin(allowed: string[], origin: string | undefined): boolean {
  const options = buildCorsOptions(allowed)!;
  const originFn = options.origin as (
    requestOrigin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => void;

  let result: boolean | undefined;
  originFn(origin, (_err, allow) => {
    result = allow;
  });
  return result === true;
}

describe('parseCorsOrigins', () => {
  it('未配置或空串得到空列表', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('')).toEqual([]);
    expect(parseCorsOrigins('  ')).toEqual([]);
  });

  it('按逗号切分并去掉空白', () => {
    expect(parseCorsOrigins('https://a.com , https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('去掉结尾斜杠', () => {
    // 浏览器发的 Origin 从不带结尾 /，留着会让白名单永远匹配不上
    expect(parseCorsOrigins('https://a.com/')).toEqual(['https://a.com']);
    expect(parseCorsOrigins('https://a.com///')).toEqual(['https://a.com']);
  });

  it('去重', () => {
    expect(parseCorsOrigins('https://a.com,https://a.com/')).toHaveLength(1);
  });
});

describe('resolveTrustProxyHops', () => {
  it('未配置时默认 0（不信任任何代理头）', () => {
    expect(resolveTrustProxyHops(undefined)).toBe(0);
    expect(resolveTrustProxyHops('')).toBe(0);
  });

  it('接受正整数', () => {
    expect(resolveTrustProxyHops('1')).toBe(1);
    expect(resolveTrustProxyHops('2')).toBe(2);
  });

  it('明确拒绝 true（安全护栏）', () => {
    // 信任任意 X-Forwarded-For 会让 req.ip 变成客户端自报值：
    // 限流可被绕过、写进 refresh_tokens 的 IP 变假数据
    expect(resolveTrustProxyHops('true')).toBe(0);
  });

  it.each(['-1', 'abc', '1.5', '0'])('非法值 %s 回退到 0', (raw) => {
    expect(resolveTrustProxyHops(raw)).toBe(0);
  });
});

describe('buildCorsOptions', () => {
  it('白名单为空时返回 undefined（调用方据此保持旧的 CORS 全开行为）', () => {
    expect(buildCorsOptions([])).toBeUndefined();
  });

  it('放行没有 Origin 的请求（小程序回归护栏）', () => {
    // 微信小程序的原生请求不发 Origin，也不做 CORS 强制。
    // 这条一旦为 false，小程序就会整体不可用。
    expect(checkOrigin(['https://ok.com'], undefined)).toBe(true);
  });

  it('白名单内的来源放行', () => {
    expect(checkOrigin(['https://ok.com'], 'https://ok.com')).toBe(true);
  });

  it('白名单外的来源拒绝（P2-2 回归护栏）', () => {
    expect(checkOrigin(['https://ok.com'], 'https://evil.com')).toBe(false);
  });

  it('带尾斜杠的请求 Origin 不匹配（Origin 不带路径/斜杠）', () => {
    expect(checkOrigin(['https://ok.com'], 'https://ok.com/')).toBe(false);
  });

  it('多来源白名单逐条匹配', () => {
    const allowed = ['https://a.com', 'http://localhost:10086'];
    expect(checkOrigin(allowed, 'https://a.com')).toBe(true);
    expect(checkOrigin(allowed, 'http://localhost:10086')).toBe(true);
    expect(checkOrigin(allowed, 'https://b.com')).toBe(false);
  });

  it('不开 credentials（认证走 Authorization 头而非 Cookie）', () => {
    expect(buildCorsOptions(['https://ok.com'])!.credentials).toBeUndefined();
  });
});
