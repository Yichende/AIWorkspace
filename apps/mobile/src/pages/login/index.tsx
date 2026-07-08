import { useEffect, useState } from 'react'
import { View, Input, Button, Text } from '@tarojs/components'
import { loginApi } from '@/services/user'
import { setToken } from '@/utils/auth'
import { useUserStore } from '@/stores/user.store'
import Taro from '@tarojs/taro'
import LogoAnimation from '../../components/LogoAnimation'
import './index.scss'

type LoginMode = 'wechat' | 'password' | 'register'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const storeSetToken = useUserStore((state) => state.setToken)
  const [showLogin, setShowLogin] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('wechat')

  // 密码登录
  const handlePwLogin = async () => {
    try {
      console.log('[Login] 发送登录请求:', { email, password })
      const res = await loginApi({
        email,
        password,
      })
      console.log('[Login] 登录成功:', res)

      // 持久化token
      await setToken(res.access_token)

      // 同步Zustand
      storeSetToken(res.access_token)

      // 跳转首页
      Taro.reLaunch({
        url: '/pages/home/index',
      })
    } catch (error: any) {
      console.error('[Login] 登录失败:', error)
      // 显示具体错误信息
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
  const handleRegister = () => {
    Taro.showToast({
      title: '注册成功',
      icon: 'success',
    })

    setLoginMode('password')
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
        {/* <View className="logo">AI</View> */}
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
            placeholder='请输入邮箱'
            placeholderClass='placeholder'
          />

          <Input
            className='input'
            placeholder='请输入验证码'
            placeholderClass='placeholder'
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
