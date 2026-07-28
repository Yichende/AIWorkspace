import { PropsWithChildren, useEffect } from 'react'
import { useLaunch } from '@tarojs/taro'
import { useUserStore } from '@/stores/user.store'
import { getToken, getRefreshToken } from '@/utils/auth'
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
  })

  // children 是将要会渲染的页面
  return children
}

export default App
