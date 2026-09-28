/**
 * 时长解析（叶子模块：不 import 任何东西）。
 *
 * ⚠️ 单位语义必须与 jsonwebtoken 保持一致 —— 后者对字符串形态的 `expiresIn`
 * 是直接交给 `ms@2` 解析的。本函数的唯一用途是让 DB 的 `expires_at` 与 JWT 的
 * `exp` **由同一个来源推导**（见 auth.service 的 getRefreshTtlMs）；两边解释一旦
 * 不同，就等于在另一个地方重新引入 M3 要消除的那类不一致。
 *
 * 一条很容易读错的规则，也是本模块**拒绝裸数字**的原因：
 *   `ms('300')` ⇒ 300 **毫秒**，而 jsonwebtoken 收到数字 300 ⇒ 300 **秒**。
 * 环境变量的值永远是字符串，所以 `JWT_REFRESH_EXPIRES_IN=604800` 会被当成
 * 604.8 秒（约 10 分钟）而不是 7 天 —— 静默地把会话寿命砍到 1/1000。
 * 与其猜用户想表达秒还是毫秒，不如直接报错要求写出单位。
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** 单位别名表，取自 ms@2 的 unit 列表（含长写法） */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  msec: 1,
  msecs: 1,
  millisecond: 1,
  milliseconds: 1,

  s: SECOND_MS,
  sec: SECOND_MS,
  secs: SECOND_MS,
  second: SECOND_MS,
  seconds: SECOND_MS,

  m: MINUTE_MS,
  min: MINUTE_MS,
  mins: MINUTE_MS,
  minute: MINUTE_MS,
  minutes: MINUTE_MS,

  h: HOUR_MS,
  hr: HOUR_MS,
  hrs: HOUR_MS,
  hour: HOUR_MS,
  hours: HOUR_MS,

  d: DAY_MS,
  day: DAY_MS,
  days: DAY_MS,

  w: WEEK_MS,
  week: WEEK_MS,
  weeks: WEEK_MS,
};

/** 单段「数值 + 单位」；刻意不支持 `1d12h` 这类多段写法 —— 与其算错不如报错 */
const DURATION_RE = /^(\d*\.?\d+)\s*([a-z]+)$/i;

/** 纯数字（无单位）—— 语义在 ms 与 jsonwebtoken 之间不一致，一律拒绝 */
const BARE_NUMBER_RE = /^\d*\.?\d+$/;

/** 取值是否是一个「可解析的时长字面量」（供启动期校验用，不抛错） */
export function isDurationLike(value: string): boolean {
  const trimmed = value.trim();
  if (BARE_NUMBER_RE.test(trimmed)) return false;

  const match = DURATION_RE.exec(trimmed);
  if (!match) return false;

  return UNIT_MS[match[2].toLowerCase()] !== undefined;
}

/**
 * 解析时长字面量为毫秒数。
 *
 * 空值 / undefined 走 fallback；非法值抛 `RangeError`（启动期 `assertRequiredEnv`
 * 已经筛过一遍，所以请求路径上不该抛到）。
 */
export function parseDurationMs(
  value: string | undefined,
  fallbackMs: number,
): number {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return fallbackMs;

  if (BARE_NUMBER_RE.test(trimmed)) {
    throw new RangeError(
      `时长必须带单位（当前 "${trimmed}"）：裸数字在 ms 里按毫秒解释、` +
        `在 jsonwebtoken 里按秒解释，两者相差 1000 倍。请写成 15m / 7d / 30s 这样的形式。`,
    );
  }

  const match = DURATION_RE.exec(trimmed);
  const unitMs = match ? UNIT_MS[match[2].toLowerCase()] : undefined;
  if (!match || unitMs === undefined) {
    throw new RangeError(
      `时长格式无法解析（当前 "${trimmed}"）：支持 <数值><单位>，` +
        `单位为 ms / s / m / h / d / w（如 30s、15m、7d）。`,
    );
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RangeError(`时长必须为正数（当前 "${trimmed}"）。`);
  }

  return Math.round(amount * unitMs);
}
