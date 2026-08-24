import Taro from '@tarojs/taro'

/**
 * 本地缓存清理工具 — 只删除"缓存类"数据，绝不触碰：
 * - 登录状态（ACCESS_TOKEN / REFRESH_TOKEN）
 * - 对话历史（chat_* 前缀，本地同步缓存）
 * - 分析结果（云端存储，本地无缓存）
 * - 云端模型（服务端下发，本地无缓存）
 * - 用户资料（user store 内存态）
 *
 * 会删除（按前缀匹配）：
 * - 临时缓存（tmp_）
 * - 图片缓存（img_）
 * - 本地草稿（draft_）
 *
 * 各业务模块写入缓存时应使用上述保留前缀。
 */
const CACHE_KEY_PREFIXES = ['tmp_', 'img_', 'draft_'] as const

/** 清除本地缓存，返回被移除的 key 列表 */
export function clearLocalCache(): string[] {
  const removed: string[] = []
  try {
    const { keys } = Taro.getStorageInfoSync()
    keys.forEach((key) => {
      if (CACHE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
        Taro.removeStorageSync(key)
        removed.push(key)
      }
    })
  } catch {
    // 存储不可用时静默失败
  }
  return removed
}
