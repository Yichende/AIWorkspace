import { isDurationLike } from '../common/duration.util';

/** 加密密钥最短长度（scrypt 接受任意长度，这里只做「明显过弱」的下限拦截） */
export const MIN_ENCRYPTION_KEY_LENGTH = 16;

/** 必填的加密密钥环境变量名 */
export const ENCRYPTION_KEY_ENV = 'MODEL_API_KEY_ENCRYPTION_KEY';

/** JWT 签名密钥最短长度：HS256 的密钥强度上限就是它的长度（256 bit = 32 字节） */
export const MIN_JWT_SECRET_LENGTH = 32;

export const JWT_SECRET_ENV = 'JWT_SECRET';
export const JWT_REFRESH_SECRET_ENV = 'JWT_REFRESH_SECRET';
export const JWT_ACCESS_EXPIRES_ENV = 'JWT_ACCESS_EXPIRES_IN';
export const JWT_REFRESH_EXPIRES_ENV = 'JWT_REFRESH_EXPIRES_IN';

export interface EnvLike {
  [key: string]: string | undefined;
}

/** 生成命令提示，两处文案复用，避免手抄漂移 */
const SECRET_GEN_HINT =
  "生成方式：node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

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
  assertEncryptionKey(env);
  assertJwtSecrets(env);
  assertJwtExpiries(env);
}

function assertEncryptionKey(env: EnvLike): void {
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

/**
 * 校验两把 JWT 密钥。
 *
 * 为什么必须在启动期校验而不是等到第一次请求：`jwt.strategy` 用的是
 * `configService.get('JWT_SECRET')!` —— 非空断言让 `undefined` 一路传到
 * passport-jwt，直到**第一次带 token 的请求**才炸，而登录接口看起来是好的。
 * 这种「一半能用」的故障状态最难排查，不如直接起不来。
 */
function assertJwtSecrets(env: EnvLike): void {
  for (const name of [JWT_SECRET_ENV, JWT_REFRESH_SECRET_ENV]) {
    const value = env[name];
    if (!value) {
      throw new Error(
        `${name} 未配置：它是访问令牌 / 刷新令牌的签名密钥，缺失时服务会在` +
          `第一次带 token 的请求上才报错（登录接口本身看起来正常，极易误判）。` +
          `请在 apps/server/.env 中设置一个至少 ${MIN_JWT_SECRET_LENGTH} 位的随机字符串（见 .env.example）。`,
      );
    }
    if (value.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `${name} 过短（当前 ${value.length} 位，至少需要 ${MIN_JWT_SECRET_LENGTH} 位）：` +
          `HS256 的密钥强度上限就是它的长度，短密钥可被离线爆破。${SECRET_GEN_HINT}`,
      );
    }
  }

  if (env[JWT_SECRET_ENV] === env[JWT_REFRESH_SECRET_ENV]) {
    throw new Error(
      `${JWT_SECRET_ENV} 与 ${JWT_REFRESH_SECRET_ENV} 不能相同：同一个密钥既签 access ` +
        `又签 refresh 时，两类令牌的 payload 形状本就只差一个 type 字段 —— ` +
        `一旦共用密钥，7 天的 refresh token 就能直接当 access token 用，` +
        `轮转、重放检测、15 分钟短寿命全部被绕过。`,
    );
  }
}

/**
 * 校验时长串可解析。
 *
 * 必须在启动期做：`auth.service` 要按 `JWT_REFRESH_EXPIRES_IN` 推算写进 DB 的
 * `expires_at`，放到请求期解析会让一个配置笔误变成「每次登录/刷新都 500」。
 */
function assertJwtExpiries(env: EnvLike): void {
  for (const name of [JWT_ACCESS_EXPIRES_ENV, JWT_REFRESH_EXPIRES_ENV]) {
    const value = env[name];
    if (value && !isDurationLike(value)) {
      throw new Error(
        `${name} 取值无法解析（当前 "${value}"）：支持 <数值><单位>，` +
          `单位为 ms / s / m / h / d / w（如 30s、15m、7d）。` +
          `注意不要写裸数字 —— 它在各处的解释不一致。`,
      );
    }
  }
}
