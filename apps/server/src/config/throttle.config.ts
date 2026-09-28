import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/** 全局默认值的环境变量名 */
export const THROTTLE_LIMIT_ENV = 'THROTTLE_DEFAULT_LIMIT';
export const THROTTLE_TTL_ENV = 'THROTTLE_DEFAULT_TTL_MS';

/** 每 IP 每分钟 120 次：移动端一次冷启动约 15 个请求，留 8 倍余量 */
export const DEFAULT_THROTTLE_LIMIT = 120;
export const DEFAULT_THROTTLE_TTL_MS = 60_000;

/**
 * 命中限流的对外文案。
 * 必须与移动端 `utils/api-error.ts` 的 `ERROR_COPY[ErrorKind.RateLimited]` 逐字一致 ——
 * 客户端优先用服务端 message，两边不一致时用户会看到同一件事的两种说法。
 */
export const THROTTLE_ERROR_MESSAGE = '操作过于频繁，请稍后再试';

/**
 * 单路由限流（按 IP）。
 *
 * 为什么是常量而不是环境变量：`@Throttle()` 的参数在**类定义期**求值，那时没有
 * ConfigService —— 装饰器只能吃模块级常量。所以只有全局默认值能入环境变量。
 *
 * 为什么用「全局守卫 + 逐路由覆写」而不是仅逐路由：仅逐路由只覆盖下面点名的
 * 这几条，其余路由（含 `GET`/`DELETE /auth/sessions`）会完全裸奔。
 *
 * 键是 `类名-方法名`（库的 generateKey 会把两者拼进去），所以每个路由一个独立
 * 计数桶，不是全局共享一个额度。
 */
export const RATE_LIMITS = {
  /** 1 小时 5 次：bcrypt cost 10 + 写库，账号批量注册是最贵的一条 */
  register: { limit: 5, ttl: 60 * 60 * 1000 },
  login: { limit: 10, ttl: 60_000 },
  /**
   * 60 次/分，刻意比默认值还宽松：客户端把**任何 401** 当成刷新信号
   * （mobile request.ts），而刷新失败会走 forceLogout（清本地登录态 + 跳登录页）。
   * 这条限流过紧会把「限流」放大成「随机登出」。
   */
  refresh: { limit: 60, ttl: 60_000 },
  /** 出网调微信 code2session */
  wechatLogin: { limit: 10, ttl: 60_000 },
  /** 与 model.controller 原 TODO 注释保持一致（10 req/min） */
  modelTest: { limit: 10, ttl: 60_000 },
  avatarUpload: { limit: 10, ttl: 60_000 },
  /** 10MB 写盘 + 同步 XLSX 解析 */
  analysisUpload: { limit: 10, ttl: 60_000 },
  /** 触发付费上游 */
  analysisCreate: { limit: 20, ttl: 60_000 },
  /**
   * SSE：守卫只在**建连时**跑一次，30 分钟的连接本身不消耗额度 ——
   * 所以全局默认值不需要为长连接放大。30/分 是给「重连 / 附着」留的额度。
   */
  analysisStream: { limit: 30, ttl: 60_000 },
  chatCompletion: { limit: 20, ttl: 60_000 },
} as const;

/**
 * 非法值回退到默认并告警。
 *
 * 这是一道安全开关：宁可限流照旧生效，也不要因为一个笔误（`abc` / `0` / `-3`）
 * 变成「无限流」——后者是静默失效，线上不会有人发现。
 */
function readPositiveInt(
  raw: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    new Logger('ThrottleConfig').warn(
      `${envName} 取值非法（${raw}），已回退到默认值 ${fallback}`,
    );
    return fallback;
  }
  return value;
}

export function buildThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        limit: readPositiveInt(
          config.get<string>(THROTTLE_LIMIT_ENV),
          DEFAULT_THROTTLE_LIMIT,
          THROTTLE_LIMIT_ENV,
        ),
        ttl: readPositiveInt(
          config.get<string>(THROTTLE_TTL_ENV),
          DEFAULT_THROTTLE_TTL_MS,
          THROTTLE_TTL_ENV,
        ),
      },
    ],
    // IPv6 按 /64 归并（库默认即 64：段内换地址几乎零成本，逐地址限等于没限）
    ipv6SubnetPrefix: 64,
    errorMessage: THROTTLE_ERROR_MESSAGE,
  };
}
