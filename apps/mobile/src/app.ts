import { PropsWithChildren, useEffect } from 'react'
import { useLaunch } from '@tarojs/taro'
import { useUserStore } from '@/stores/user.store'
import { getToken } from '@/utils/auth'

import './app.scss'

function App({ children }: PropsWithChildren<any>) {
  const setToken = useUserStore((state) => state.setToken)

  useEffect(() => {
    const initAuth = async () => {
      const token = await getToken()

      if (token) {
        setToken(token)
      }
    }

    initAuth()
  }, [])
  useLaunch(() => {
    console.log('App launched.')
  })

  // children 是将要会渲染的页面
  return children
}

export default App
