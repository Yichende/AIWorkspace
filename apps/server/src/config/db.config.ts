import { Logger } from '@nestjs/common';

/** 是否输出 SQL 语句 */
export const DB_LOGGING_ENV = 'DB_LOGGING';

/** 视为「开」的取值（大小写不敏感）；其余一律按关处理 */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export interface DbEnvLike {
  [key: string]: string | undefined;
}

/** 取值是否表示「打开 SQL 日志」 */
export function isSqlLoggingEnabled(env: DbEnvLike): boolean {
  const raw = (env[DB_LOGGING_ENV] ?? '').trim().toLowerCase();
  return TRUTHY.has(raw);
}

/**
 * 构造 Sequelize 的 `logging` 选项。**默认 false（不输出）**。
 *
 * 为什么默认关掉：后台管家查询会持续刷屏，把真正要看的信息顶掉。实测
 * 一台**完全空闲**的服务器 60 秒内产生 26 行日志 —— **全部**是 SQL，其中
 * 24 行是 worker 每 3 秒一次的 `analysis_tasks` 轮询，单行 499 字符，
 * 合计每分钟约 1.1 万字符的噪声，且一条应用日志都没有。分析进行中还会叠加
 * 30 秒一次的心跳与每个进度事件的 UPDATE。
 *
 * 需要排查 SQL 时在 `.env` 里开 `DB_LOGGING=true`。届时后台管家查询仍然
 * 不打印（那些调用点各自标了 `logging: false`），所以看到的就是你关心的那些。
 *
 * 走 Nest 的 Logger 而不是 `console.log`：有级别、有上下文、格式与其他日志一致，
 * 且想彻底静音时可以只从 `main.ts` 的 logger 级别里去掉 `debug`。
 */
export function resolveSqlLogging(
  env: DbEnvLike = process.env,
): false | ((sql: string) => void) {
  if (!isSqlLoggingEnabled(env)) return false;

  const logger = new Logger('SQL');
  return (sql: string) => logger.debug(sql);
}
