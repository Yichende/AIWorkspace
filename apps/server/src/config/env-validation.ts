/** 加密密钥最短长度（scrypt 接受任意长度，这里只做「明显过弱」的下限拦截） */
export const MIN_ENCRYPTION_KEY_LENGTH = 16;

/** 必填的加密密钥环境变量名 */
export const ENCRYPTION_KEY_ENV = 'MODEL_API_KEY_ENCRYPTION_KEY';

export interface EnvLike {
  [key: string]: string | undefined;
}

/**
 * 校验启动必需的环境变量，不满足则抛错。
 *
 * 为什么必须「启动即失败」而不是退化：密钥缺失时若生成进程内随机密钥，
 * 用该密钥加密的自定义模型 API Key 在**下次重启后永久无法解密** —— 而且
 * 用户当时不会看到任何异常，等发现时数据已经解不开了。宁可起不来。
 *
 * 放在 bootstrap 最前面（而不是某个 provider 的构造函数里）有两个好处：
 * 报错更早、信息更清楚；以及测试直接实例化 service 时不经过 bootstrap，
 * 因此 CI 不需要这个密钥也能全绿。
 */
export function assertRequiredEnv(env: EnvLike = process.env): void {
  const key = env[ENCRYPTION_KEY_ENV];
  if (!key) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} 未配置：该密钥用于加密用户自建模型的 API Key，` +
        `缺失时生成的密文在重启后将无法解密。请在 apps/server/.env 中设置一个` +
        `至少 ${MIN_ENCRYPTION_KEY_LENGTH} 位的随机字符串（见 .env.example）。`,
    );
  }
  if (key.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} 过短（当前 ${key.length} 位，至少需要 ${MIN_ENCRYPTION_KEY_LENGTH} 位）。`,
    );
  }
}
