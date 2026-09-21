import { describe, expect, it } from 'vitest'
import {
  ApiError,
  ERROR_COPY,
  ErrorKind,
  isApiError,
  toApiError,
} from '../src/utils/api-error'

describe('toApiError 归一化', () => {
  it('服务端错误体 → 保留 message、按 statusCode 派生 kind', () => {
    const e = toApiError({
      statusCode: 400,
      message: '仅支持 .xlsx .xls .csv 格式',
      path: '/analysis/upload',
    })
    expect(e).toBeInstanceOf(ApiError)
    expect(e.kind).toBe(ErrorKind.Validation)
    expect(e.status).toBe(400)
    expect(e.message).toBe('仅支持 .xlsx .xls .csv 格式')
    expect(e.path).toBe('/analysis/upload')
  })

  it('服务端 message 优先于内置文案表（服务端文案更具体）', () => {
    const e = toApiError({ statusCode: 404, message: '分析任务不存在' })
    expect(e.message).toBe('分析任务不存在')
    expect(e.message).not.toBe(ERROR_COPY[ErrorKind.NotFound])
  })

  it.each([
    [401, ErrorKind.Auth],
    [403, ErrorKind.Permission],
    [404, ErrorKind.NotFound],
    [409, ErrorKind.Conflict],
    [429, ErrorKind.RateLimited],
    [400, ErrorKind.Validation],
    [422, ErrorKind.Validation],
    [500, ErrorKind.Server],
    [503, ErrorKind.Server],
  ])('状态码 %i → kind %s', (status, kind) => {
    expect(toApiError({ statusCode: status, message: 'x' }).kind).toBe(kind)
  })

  it('Taro 传输层错误：timeout → Timeout', () => {
    const e = toApiError({ errMsg: 'request:fail timeout' })
    expect(e.kind).toBe(ErrorKind.Timeout)
    expect(e.status).toBeUndefined()
  })

  it('Taro 传输层错误：其它 → Network', () => {
    expect(toApiError({ errMsg: 'request:fail' }).kind).toBe(ErrorKind.Network)
  })

  it('拔掉 errMsg 的 abort → Aborted', () => {
    expect(toApiError({ errMsg: 'request:fail abort' }).kind).toBe(
      ErrorKind.Aborted,
    )
  })

  it('裸字符串作为文案可用（服务端 SSE error 帧的场景）', () => {
    const e = toApiError('分析失败')
    expect(e.message).toBe('分析失败')
  })

  it('JSON 字符串体会被拆出 message —— 不把整坨 JSON 糊给用户', () => {
    const e = toApiError('{"statusCode":400,"message":"文件已过期，请重新上传"}')
    expect(e.message).toBe('文件已过期，请重新上传')
    expect(e.message.startsWith('{')).toBe(false)
  })

  it('拆不出 message 的 JSON 串回退文案表', () => {
    const e = toApiError('{"foo":1}', '上传失败')
    expect(e.message).toBe('上传失败')
  })

  it('HTML 响应体不作为文案展示', () => {
    const e = toApiError('<html><body>502 Bad Gateway</body></html>')
    expect(e.message.startsWith('<')).toBe(false)
    expect(e.message).toBe(ERROR_COPY[ErrorKind.Unknown])
  })

  it('空字符串回退到 fallback 再到文案表', () => {
    expect(toApiError('', '兜底').message).toBe('兜底')
    expect(toApiError('').message).toBe(ERROR_COPY[ErrorKind.Unknown])
  })

  it('null / undefined 不抛错，message 仍非空', () => {
    expect(toApiError(null).message.length).toBeGreaterThan(0)
    expect(toApiError(undefined).message.length).toBeGreaterThan(0)
  })
})

describe('toApiError 幂等性（关键）', () => {
  it('已是 ApiError 时原样返回同一实例', () => {
    const original = toApiError({ statusCode: 409, message: '模型名称已存在' })
    const again = toApiError(original)
    expect(again).toBe(original)
  })

  it('二次归一化不丢 serverCode / raw / status', () => {
    const original = new ApiError({
      kind: ErrorKind.Conflict,
      status: 409,
      message: '冲突',
      serverCode: 'MODEL_NAME_EXISTS',
      raw: { a: 1 },
    })
    const again = toApiError(original)
    expect(again.serverCode).toBe('MODEL_NAME_EXISTS')
    expect(again.raw).toEqual({ a: 1 })
    expect(again.status).toBe(409)
    expect(again.kind).toBe(ErrorKind.Conflict)
  })

  it('带 fallback 二次归一化时仍不覆盖已有值', () => {
    const original = toApiError({ statusCode: 500, message: '服务炸了' })
    const again = toApiError(original, '请求失败')
    expect(again).toBe(original)
    expect(again.message).toBe('服务炸了')
  })

  it('isApiError 能区分 ApiError 与普通 Error', () => {
    expect(isApiError(toApiError('x'))).toBe(true)
    expect(isApiError(new Error('x'))).toBe(false)
    expect(isApiError('x')).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})

describe('文案表完整性', () => {
  it('每个 ErrorKind 都有非空文案（Record 保证穷尽，这里保证质量）', () => {
    for (const kind of Object.values(ErrorKind)) {
      expect(ERROR_COPY[kind], `缺少文案: ${kind}`).toBeTruthy()
    }
  })
})
