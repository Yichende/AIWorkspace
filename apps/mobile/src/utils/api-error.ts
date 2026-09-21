/**
 * 统一的前端错误对象。
 *
 * ⚠️ 关于「业务码」：服务端**没有**业务码字段 —— `all-exceptions.filter.ts` 只返回
 * `{ statusCode, message, timestamp, path }`。所以这里的 `kind` 是**客户端派生**的
 * 分类，不是服务端下发的码，不要当成协议契约使用。`serverCode` 只是为将来预留的
 * 空槽位（届时只改 `deriveKind` 一处）。
 *
 * 本模块**不 import 任何东西**（不碰 Taro / `@/` / `@repo/*`），因此
 * request.ts、token-refresh.ts、各 service 都能安全依赖它而不成环。
 */

export enum ErrorKind {
  /** 401 且刷新失败 —— 走登出流程 */
  Auth = 'AUTH',
  /** 403 */
  Permission = 'PERMISSION',
  /** 404 */
  NotFound = 'NOT_FOUND',
  /** 400 / 422 */
  Validation = 'VALIDATION',
  /** 409 */
  Conflict = 'CONFLICT',
  /** 429 */
  RateLimited = 'RATE_LIMITED',
  /** 5xx */
  Server = 'SERVER',
  /** 传输层超时 */
  Timeout = 'TIMEOUT',
  /** 离线 / DNS / 域名校验失败 */
  Network = 'NETWORK',
  /** 用户主动中止 */
  Aborted = 'ABORTED',
  /** 服务端 SSE 的 error 帧（裸字符串，非 HTTP 错误体） */
  Stream = 'STREAM',
  /** 响应体无法解析 */
  Parse = 'PARSE',
  Unknown = 'UNKNOWN',
}

export interface ApiErrorInit {
  kind: ErrorKind
  /** 有 HTTP 响应时的状态码；传输层/流式错误没有 */
  status?: number
  /** 可直接展示的中文文案，保证非空 */
  message: string
  /** 仅当服务端将来真的下发业务码时才有值 */
  serverCode?: string
  /** 原始错误体 / Taro 错误对象 / 裸字符串，仅供日志 */
  raw?: unknown
  path?: string
}

export class ApiError extends Error implements ApiErrorInit {
  readonly kind: ErrorKind
  readonly status?: number
  readonly serverCode?: string
  readonly raw?: unknown
  readonly path?: string

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.kind = init.kind
    this.status = init.status
    this.serverCode = init.serverCode
    this.raw = init.raw
    this.path = init.path
    // 继承内置 Error 时需要修正原型链，否则 instanceof 在部分编译目标下失效
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

/**
 * 兜底文案表。按 `ErrorKind` 键，`Record` 保证穷尽 —— 新增 kind 会编译不过。
 *
 * 不按 statusCode 键：移动端最主要的失败（离线、超时、用户中止、流中断）
 * 根本没有状态码；`ErrorKind` 是闭集合，可以穷尽，statusCode 不行。
 */
export const ERROR_COPY: Record<ErrorKind, string> = {
  [ErrorKind.Auth]: '登录已过期，请重新登录',
  [ErrorKind.Permission]: '没有权限执行此操作',
  [ErrorKind.NotFound]: '内容不存在或已被删除',
  [ErrorKind.Validation]: '提交的内容不合法',
  [ErrorKind.Conflict]: '操作冲突，请刷新后重试',
  [ErrorKind.RateLimited]: '操作过于频繁，请稍后再试',
  [ErrorKind.Server]: '服务异常，请稍后重试',
  [ErrorKind.Timeout]: '请求超时，请检查网络后重试',
  [ErrorKind.Network]: '网络异常，请检查网络连接',
  [ErrorKind.Aborted]: '已取消',
  [ErrorKind.Stream]: '分析中断，请重试',
  [ErrorKind.Parse]: '数据解析失败',
  [ErrorKind.Unknown]: '操作失败，请重试',
}

/** 从 HTTP 状态码派生分类 */
function deriveKind(status: number): ErrorKind {
  if (status === 401) return ErrorKind.Auth
  if (status === 403) return ErrorKind.Permission
  if (status === 404) return ErrorKind.NotFound
  if (status === 409) return ErrorKind.Conflict
  if (status === 429) return ErrorKind.RateLimited
  if (status >= 500) return ErrorKind.Server
  if (status >= 400) return ErrorKind.Validation
  return ErrorKind.Unknown
}

/**
 * 判断候选文案是否可用：必须是字符串、非空，且不是被误当作文案的
 * JSON 体或 HTML（`Taro.uploadFile` 的 `res.data` 就是字符串形式的 JSON，
 * 直接展示会把整段 `{"statusCode":400,...}` 糊到用户脸上）。
 */
function usableMessage(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  const t = text.trim()
  if (!t) return undefined
  if (t.startsWith('{') || t.startsWith('[') || t.startsWith('<')) {
    return undefined
  }
  return t
}

/**
 * 尝试取出可展示的服务端文案，三种来源依次尝试：
 *   1. 对象形态的错误体 → `.message`
 *   2. 字符串形态的 JSON 错误体 → 解析后的 `.message`
 *   3. 字符串本身 → 直接当文案
 *
 * 第 3 条是必须的：SSE 的 `error` 帧就是**裸字符串**（`sseWrite('error', msg)`），
 * 旧代码里 request.ts 也会 `reject("登录失效")`。漏掉它会让这些错误退化成
 * 泛泛的兜底文案。
 */
function extractServerMessage(input: unknown): string | undefined {
  if (typeof input === 'object' && input !== null) {
    return usableMessage((input as any).message)
  }
  if (typeof input === 'string') {
    const direct = usableMessage(input)
    if (direct && !direct.startsWith('{') && !direct.startsWith('[')) {
      return direct
    }
    try {
      const parsed = JSON.parse(input)
      return usableMessage(parsed?.message)
    } catch {
      // 既不是可用文案、也不是 JSON —— 交给上层回退
      return undefined
    }
  }
  return undefined
}

/** 尝试挖出服务端业务码（当前恒为 undefined，预留给将来） */
function extractServerCode(input: unknown): string | undefined {
  if (typeof input === 'object' && input !== null) {
    const c = (input as any).code ?? (input as any).errorCode
    return typeof c === 'string' ? c : undefined
  }
  return undefined
}

/**
 * 把任意抛出物归一化成 ApiError。
 *
 * **幂等**：已经是 ApiError 就原样返回 —— request.ts 的 catch 兜底会再归一化
 * 一次，若不幂等会把 serverCode/raw/status 丢掉、退化成 Unknown。
 *
 * **全函数**：不抛、不返回 null、`message` 保证非空。
 *
 * 文案优先级：服务端 message（最具体、最可操作，全仓 53 处 `throw new
 * XException('<中文>')` 都是它）> 传入的 fallback > 内置文案表。
 */
export function toApiError(input: unknown, fallback?: string): ApiError {
  if (isApiError(input)) return input

  const serverMsg = extractServerMessage(input)
  const serverCode = extractServerCode(input)

  const status =
    typeof (input as any)?.statusCode === 'number'
      ? (input as any).statusCode
      : typeof (input as any)?.status === 'number'
        ? (input as any).status
        : undefined

  // Taro 传输层错误：{ errMsg: 'request:fail ...' }
  const errMsg = typeof (input as any)?.errMsg === 'string' ? (input as any).errMsg : undefined
  if (status === undefined && errMsg) {
    const kind = /timeout/i.test(errMsg)
      ? ErrorKind.Timeout
      : /abort/i.test(errMsg)
        ? ErrorKind.Aborted
        : ErrorKind.Network
    return new ApiError({
      kind,
      message: fallback || ERROR_COPY[kind],
      raw: input,
    })
  }

  const kind = status === undefined ? ErrorKind.Unknown : deriveKind(status)
  return new ApiError({
    kind,
    status,
    message:
      serverMsg ||
      fallback ||
      ERROR_COPY[kind],
    serverCode,
    raw: input,
    path: typeof (input as any)?.path === 'string' ? (input as any).path : undefined,
  })
}
