import { describe, expect, it } from 'vitest'
import type { MessageStatus } from '@repo/types'
import {
  PROMOTABLE_STATUSES,
  canPromoteToSuccess,
} from '../src/utils/message-status'

describe('canPromoteToSuccess', () => {
  it('允许提升「进行中」的两个状态', () => {
    expect(canPromoteToSuccess('sending')).toBe(true)
    expect(canPromoteToSuccess('streaming')).toBe(true)
  })

  it('禁止提升两个终态', () => {
    expect(canPromoteToSuccess('success')).toBe(false)
    expect(canPromoteToSuccess('error')).toBe(false)
  })

  it('覆盖 MessageStatus 的全部取值（新增状态时必须显式归类）', () => {
    const all: MessageStatus[] = ['sending', 'streaming', 'success', 'error']
    const promoted = all.filter(canPromoteToSuccess)
    expect(promoted).toEqual([...PROMOTABLE_STATUSES])
  })
})

describe('P0-1 回归：error 消息不得被流结束兜底翻成 success', () => {
  it('服务端先发 error 帧、随后正常关闭连接时保持 error', () => {
    // 模拟 chat.controller 的状态流转：
    // 占位消息 streaming → onError 置 error → 流 promise 结束时的兜底判定
    let status: MessageStatus = 'streaming'
    const onError = () => {
      status = 'error'
    }
    const finalFlush = () => {
      // 修复前这里是 `status !== 'success'`，会把 error 改写为 success
      if (canPromoteToSuccess(status)) status = 'success'
    }

    onError()
    finalFlush()

    expect(status).toBe('error')
  })

  it('正常结束（无 error 帧）时仍会被兜底提升为 success', () => {
    let status: MessageStatus = 'streaming'
    if (canPromoteToSuccess(status)) status = 'success'
    expect(status).toBe('success')
  })
})
