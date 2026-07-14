import { useEffect, useState } from 'react'
import { View, Input, Button, Text } from '@tarojs/components'
import { loginApi, registerApi } from '@/services/user'
import { setToken, setRefreshToken, getToken } from '@/utils/auth'
import { useUserStore } from '@/stores/user.store'
import Taro from '@tarojs/taro'
import LogoAnimation from '../../components/LogoAnimation'
import './index.scss'

type LoginMode = 'wechat' | 'password' | 'register'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const storeSetToken = useUserStore((state) => state.setToken)
  const storeSetRefreshToken = useUserStore((state) => state.setRefreshToken)
  const [showLogin, setShowLogin] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('wechat')

  // 已有 token → 自动跳转首页
  const token = useUserStore((state) => state.token)

  useEffect(() => {
    const checkAndRedirect = async () => {
      const storedToken = token || (await getToken())
      if (storedToken) {
        Taro.reLaunch({ url: '/pages/home/index' })
      }
    }
    checkAndRedirect()
  }, [])

  // 保存 token 到本地和 store
  const saveTokens = async (accessToken: string, refreshToken: string) => {
    await setToken(accessToken)
    await setRefreshToken(refreshToken)
    storeSetToken(accessToken)
    storeSetRefreshToken(refreshToken)
  }

  // 密码登录
  const handlePwLogin = async () => {
    try {
      console.log('[Login] 发送登录请求:', { email, password })
      const res = await loginApi({
        email,
        password,
      })
      console.log('[Login] 登录成功:', res)

      await saveTokens(res.access_token, res.refresh_token)

      // 跳转首页
      Taro.reLaunch({
        url: '/pages/home/index',
      })
    } catch (error: any) {
      console.error('[Login] 登录失败:', error)
      const errMsg = typeof error === 'string'
        ? error
        : error?.message || error?.errMsg || JSON.stringify(error)
      Taro.showToast({
        title: errMsg.length > 30 ? errMsg.slice(0, 30) + '...' : errMsg,
        icon: 'none',
        duration: 3000,
      })
    }
  }

  // 微信登录
  const handleWechatLogin = () => {
    Taro.showToast({
      title: '微信登录开发中',
      icon: 'none',
    })
  }

  // 注册
  const handleRegister = async () => {
    if (password !== confirmPassword) {
      Taro.showToast({
        title: '两次密码不一致',
        icon: 'none',
      })
      return
    }

    try {
      const res = await registerApi({
        username,
        email,
        password,
      })

      await saveTokens(res.access_token, res.refresh_token)

      Taro.showToast({
        title: '注册成功',
        icon: 'success',
      })

      // 跳转首页
      Taro.reLaunch({
        url: '/pages/home/index',
      })
    } catch (error: any) {
      const errMsg = typeof error === 'string'
        ? error
        : error?.message || error?.errMsg || JSON.stringify(error)
      Taro.showToast({
        title: errMsg.length > 30 ? errMsg.slice(0, 30) + '...' : errMsg,
        icon: 'none',
        duration: 3000,
      })
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowLogin(true)
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <View className='login-page'>
      {/* 背景光晕 */}
      <View className='bg-light' />

      {/* Logo 区域 */}
      <View className={`logo-section ${showLogin ? 'logo-active' : ''}`}>
        <LogoAnimation />

        <View className={`app-title ${showLogin ? 'title-show' : ''}`}>
          <Text className='main-title'>一叶</Text>
        </View>
      </View>

      {/* 登录区域 */}
      <View className={`login-wrapper ${showLogin ? 'wrapper-show' : ''}`}>
        {/* 微信登录 */}
        <View
          className={`panel wechat-panel ${
            loginMode === 'wechat' ? 'panel-active' : 'panel-left'
          }`}
        >
          <Button className='wechat-btn' onClick={handleWechatLogin}>
            微信一键登录
          </Button>

          <Text
            className='switch-text'
            onClick={() => setLoginMode('password')}
          >
            使用邮箱密码登录 →
          </Text>
        </View>

        {/* 密码登录 */}
        <View
          className={`panel password-panel ${
            loginMode === 'password'
              ? 'panel-active'
              : loginMode === 'wechat'
                ? 'panel-right'
                : 'panel-left'
          }`}
        >
          <Text className='back-text' onClick={() => setLoginMode('wechat')}>
            ← 微信登录
          </Text>

          <Text
            className='register-text'
            onClick={() => setLoginMode('register')}
          >
            注册
          </Text>

          <Input
            className='input'
            placeholder='请输入邮箱'
            placeholderClass='placeholder'
            value={email}
            onInput={(e) => setEmail(e.detail.value)}
          />

          <Input
            className='input'
            password
            placeholder='请输入密码'
            placeholderClass='placeholder'
            value={password}
            onInput={(e) => setPassword(e.detail.value)}
          />

          <Button className='login-btn' onClick={handlePwLogin}>
            登录
          </Button>
        </View>

        {/* 注册 */}
        <View
          className={`panel register-panel ${
            loginMode === 'register' ? 'register-active' : 'register-hidden'
          }`}
        >
          <Text className='back-text' onClick={() => setLoginMode('password')}>
            ← 返回登录
          </Text>

          <Input
            className='input'
            placeholder='请输入用户名'
            placeholderClass='placeholder'
            value={username}
            onInput={(e) => setUsername(e.detail.value)}
          />

          <Input
            className='input'
            placeholder='请输入邮箱'
            placeholderClass='placeholder'
            value={email}
            onInput={(e) => setEmail(e.detail.value)}
          />

          <Input
            className='input'
            password
            placeholder='请输入密码'
            placeholderClass='placeholder'
            value={password}
            onInput={(e) => setPassword(e.detail.value)}
          />

          <Input
            className='input'
            password
            placeholder='确认密码'
            placeholderClass='placeholder'
            value={confirmPassword}
            onInput={(e) => setConfirmPassword(e.detail.value)}
          />

          <Button className='login-btn' onClick={handleRegister}>
            注册账号
          </Button>
        </View>
      </View>
    </View>
  )
}
