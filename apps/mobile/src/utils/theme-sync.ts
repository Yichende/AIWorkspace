import Taro from '@tarojs/taro'
import type { ThemeMode } from '@/stores/settings.store'

/** 与 app.scss 中 --bg-page 的浅/暗值保持一致 */
const PAGE_BG: Record<ThemeMode, string> = {
  light: '#F1ECE0',
  dark: '#1C1712',
}

/**
 * 同步主题到原生层（页面树内由 .theme-dark 类负责，这里只处理原生窗口本身）：
 * - 小程序：设置原生窗口背景色，滚动回弹/露底时不穿帮
 * - H5：给 html 挂 theme-dark 类，body 露底背景跟随
 */
export function syncNativeTheme(theme: ThemeMode): void {
  try {
    if (process.env.TARO_ENV === 'h5') {
      document.documentElement.classList.toggle('theme-dark', theme === 'dark')
    } else {
      Taro.setBackgroundColor({ backgroundColor: PAGE_BG[theme] })
    }
  } catch {
    // 原生同步失败不影响内存状态与 CSS 变量
  }
}
