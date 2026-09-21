import Taro from '@tarojs/taro'
import { toApiError } from '@/utils/api-error'
import { getValidAccessToken } from '@/services/token-refresh'

export interface UploadWithAuthOptions {
  url: string
  filePath: string
  /** multipart 的字段名 */
  name: string
  formData?: Record<string, string>
}

/**
 * 带鉴权的文件上传（analysis 上传表格 / 用户上传头像共用）。
 *
 * 把两处此前近乎逐字重复的 `Taro.uploadFile` 封装收敛到一处
 * （连兜底文案都一样）。
 *
 * ⚠️ `await getValidAccessToken()` **必须在构造 Promise 之前**：
 * 写在 executor 内部的话，一旦取 token 抛错，外层 Promise 会永久 pending
 * （executor 里抛出的异常不会 reject 外层 Promise，只会被吞掉）。
 */
export async function uploadWithAuth<T>(
  options: UploadWithAuthOptions,
): Promise<T> {
  const { url, filePath, name, formData } = options
  // 临期则先刷新（单飞，与其他请求共享同一次刷新）
  const token = await getValidAccessToken()

  return new Promise<T>((resolve, reject) => {
    Taro.uploadFile({
      url,
      filePath,
      name,
      ...(formData ? { formData } : {}),
      header: {
        Authorization: token ? `Bearer ${token}` : '',
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(res.data) as T)
          } catch {
            reject(new Error('上传响应解析失败'))
          }
        } else {
          // res.data 是字符串（通常是服务端 JSON 错误体）：
          // toApiError 会挖出 message，挖不到则回退文案表，
          // 绝不把整段 {"statusCode":400,...} 直接展示给用户
          reject(toApiError(res.data, '上传失败'))
        }
      },
      fail: (err) => {
        reject(toApiError(err, '上传失败'))
      },
    })
  })
}
