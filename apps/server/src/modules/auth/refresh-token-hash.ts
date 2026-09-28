import { createHash, timingSafeEqual } from 'crypto';

/**
 * refresh token 的存储摘要与校验。
 *
 * **为什么不用 bcrypt**（这曾经是个真实缺陷）：bcrypt 只取输入的**前 72 字节**，
 * 而 JWT 形态的 refresh token 长约 262 字符。它的前 72 字节是 base64url 编码的
 * header + payload 开头（大致 `{"id":N,"type":"refresh"...`），**对同一用户而言
 * 完全一样** —— 于是库里存的 hash 无法区分同一用户的任意两个 token：
 * 「轮转」写完新 hash 后，旧 token 照样匹配得上，重放检测那道分支永远不会触发。
 *
 * 这不是理论推演，是实测结论：构造一个前 72 字节相同、之后完全不同的字符串，
 * `bcrypt.compare` 返回 true；而只改动第 72 字节则返回 false。
 *
 * 换成 sha256 还顺带解决两件事：
 *   - refresh token 本身就是 256 位高熵的 HMAC，bcrypt「拖慢低熵口令的暴力破解」
 *     的用途在这里没有意义；
 *   - 免掉每次登录 / 刷新约 100ms 的 cost-10 开销。
 *
 * ⚠️ 这是**存储格式**的变更：`token_hash` 由 bcrypt 串（`$2b$10$…`）变为
 * 64 位 hex。格式变更本身不提供任何迁移 —— 但 JWT_REFRESH_SECRET 一旦轮换，
 * 存量 refresh token 就已经在 `jwtService.verify` 那一关全部失效了，所以生产上
 * 这次切换不会额外踢掉任何人（两条路径都要求重新登录）。
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * 校验 token 是否与存储的摘要匹配。
 *
 * 用定时安全比较而不是 `===`：字符串比较会在首个不同字节处提前返回，
 * 理论上构成时序侧信道。两者的长度都是固定的 64 字符，所以长度不等
 * 只可能是脏数据，直接判否（长度本身不是秘密）。
 */
export function verifyRefreshToken(
  token: string,
  storedHash: string | null | undefined,
): boolean {
  const actual = Buffer.from(hashRefreshToken(token), 'utf8');
  const expected = Buffer.from(storedHash ?? '', 'utf8');

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
