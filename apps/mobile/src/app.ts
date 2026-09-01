import { PropsWithChildren, useEffect } from 'react'
import { useLaunch } from '@tarojs/taro'
import { useUserStore } from '@/stores/user.store'
import { useSettingsStore } from '@/stores/settings.store'
import { getToken, getRefreshToken } from '@/utils/auth'
import { syncNativeTheme } from '@/utils/theme-sync'
import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  const setToken = useUserStore((state) => state.setToken)
  const setRefreshToken = useUserStore((state) => state.setRefreshToken)
  const setAuthReady = useUserStore((state) => state.setAuthReady)

  useEffect(() => {
    const initAuth = async () => {
      const token = await getToken()
      const refreshToken = await getRefreshToken()

      if (token) {
        setToken(token)
      }
      if (refreshToken) {
        setRefreshToken(refreshToken)
      }
      // 标记 auth 初始化完成——解除 ChatPage 的 API 调用阻塞
      setAuthReady()
    }

    initAuth()
  }, [setToken, setRefreshToken, setAuthReady])
  
  useLaunch(() => {
    console.log('App launched.')
    // 启动即同步原生窗口背景（store 模块加载时已从 storage 读出主题，登录前也生效）
    syncNativeTheme(useSettingsStore.getState().theme)
  })

  // children 是将要会渲染的页面
  return children
}

export default App
