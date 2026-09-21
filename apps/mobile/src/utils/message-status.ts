import type { MessageStatus } from '@repo/types'

/**
 * 只有「进行中」的消息可以被兜底提升为成功。
 *
 * success / error 是终态：服务端可能先发 error 事件再正常关闭连接，
 * 此时 onDone 与流 promise 的兜底分支都不允许把它改写回 success
 * （用允许列表而非 `status !== 'success'` 的拒绝列表 —— 新增终态时
 * 拒绝列表会静默失效）。
 */
export const PROMOTABLE_STATUSES: readonly MessageStatus[] = [
  'sending',
  'streaming',
]

/** 该状态是否仍可被兜底提升为 success */
export function canPromoteToSuccess(status: MessageStatus): boolean {
  return PROMOTABLE_STATUSES.includes(status)
}
