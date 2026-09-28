import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** CORS 来源白名单（逗号分隔）；留空表示沿用全开行为 */
export const CORS_ORIGINS_ENV = 'CORS_ORIGINS';

/** 反代跳数；决定 req.ip，而 req.ip 同时是限流键与 refresh_tokens.ip_address 的来源 */
export const TRUST_PROXY_HOPS_ENV = 'TRUST_PROXY_HOPS';

/**
 * 解析来源白名单：逗号分隔，去空白，去结尾斜杠，去重。
 *
 * 去结尾斜杠是必须的 —— 浏览器发的 `Origin` 从不带结尾 `/`，
 * 配成 `https://a.com/` 会永远匹配不上（等于配了没生效）。
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  return Array.from(
    new Set(
      (raw ?? '')
        .split(',')
        .map((item) => item.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  );
}

/**
 * 解析反代跳数。直连 `0`（不信任任何代理头），Nginx 一层 `1`。
 *
 * 只接受正整数，**明确拒绝 `true`**：信任任意 `X-Forwarded-For` 会让 `req.ip`
 * 变成客户端自报值 —— 限流可被绕过，写进 refresh_tokens 的 IP 也变成假数据。
 */
export function resolveTrustProxyHops(raw: string | undefined): number {
  const hops = Number((raw ?? '').trim());
  return Number.isInteger(hops) && hops > 0 ? hops : 0;
}

/**
 * 构造 CORS 选项。白名单为空时返回 `undefined`，调用方据此保持旧的
 * `enableCors()`（来源全开）并只在启动日志里告警。
 *
 * 为什么不「白名单为空就拒绝启动」：微信开发者工具 / H5 本地调试的 origin
 * 千变万化，硬失败会把「本机跑不起来」变成一个很难自查的问题；而这条开关
 * 一旦配错，唯一后果是 H5 跨域被浏览器拦下，小程序完全不受影响。
 */
export function buildCorsOptions(allowed: string[]): CorsOptions | undefined {
  if (allowed.length === 0) return undefined;

  return {
    origin: (origin, callback) => {
      // 无 Origin ⇒ 不是浏览器跨域请求（微信小程序原生请求 / curl / 服务端调用）。
      // 注意 cors 中间件只写响应头、**从不阻断请求**，所以放行这里不会成为漏洞。
      if (!origin) return callback(null, true);
      callback(null, allowed.includes(origin));
    },
    // 刻意不开 credentials：认证走 Authorization 头而不是 Cookie，
    // 开了只会多一个 Access-Control-Allow-Credentials 的攻击面。
  };
}
