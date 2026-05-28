import { useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Input, Button } from '@tarojs/components'
import { loginApi } from '@/services/user'
import { setToken } from '@/utils/auth'
import { useUserStore } from '@/stores/user.store'
import './index.scss'

export default function LoginPage() {
  const [username, setUsername] = useState('')

  const [password, setPassword] = useState('')

  const storeSetToken = useUserStore((state) => state.setToken)

  /**
   * 登录
   */
  const handleLogin = async () => {
    try {
      // const res = await loginApi({
      //   username,
      //   password,
      // })
      const mockToken = "mock-token"

      /**
       * 持久化 Token
       */
      // await setToken(res.access_token)
      await setToken(mockToken)

      /**
       * 同步 Zustand
       */
      // storeSetToken(res.access_token)
      storeSetToken(mockToken)

      /**
       * 跳转首页
       */
      Taro.reLaunch({
        url: '/pages/home/index',
      })
    } catch (error) {
      Taro.showToast({
        title: '登录失败',

        icon: 'none',
      })
    }
  }

  return (
    <View className='login-page'>
      <Input
        placeholder='请输入账号'
        value={username}
        onInput={(e) => setUsername(e.detail.value)}
      />

      <Input
        password
        placeholder='请输入密码'
        value={password}
        onInput={(e) => setPassword(e.detail.value)}
      />

      <Button onClick={handleLogin}>登录</Button>
    </View>
  )
}
