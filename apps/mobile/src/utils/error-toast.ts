import Taro from '@tarojs/taro'
import { toApiError } from './api-error'

/** 小程序 toast 单行可读长度上限（超出会折行/被截断，观感差） */
const TOAST_MAX_LEN = 30

/**
 * 统一的错误提示：把任意抛出物归一化后以 toast 展示。
 *
 * 一行接入，页面不再各写 `typeof error === 'string'` / `err.message || '兜底'`。
 * 30 字截断此前只存在于登录页，现在收成通用能力。
 */
export function showErrorToast(err: unknown, fallback?: string): void {
  const message = toApiError(err, fallback).message
  Taro.showToast({
    title:
      message.length > TOAST_MAX_LEN
        ? `${message.slice(0, TOAST_MAX_LEN)}...`
        : message,
    icon: 'none',
    duration: 3000,
  })
}
