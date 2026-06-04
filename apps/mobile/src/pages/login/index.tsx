import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Input, Button, Text } from '@tarojs/components'
import { loginApi } from '@/services/user'
import { setToken } from '@/utils/auth'
import { useUserStore } from '@/stores/user.store'
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
      // const res = await loginApi({
      //   username,
      //   password,
      // })
      const mockToken = 'mock-token'

      // 持久化token
      // await setToken(res.access_token)
      await setToken(mockToken)

      // 同步Zustand
      // storeSetToken(res.access_token)
      storeSetToken(mockToken)

      // 跳转首页
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
