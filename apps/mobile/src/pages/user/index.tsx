import { View, Text, Image, Switch } from '@tarojs/components'
import { useCallback, useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { AppHeader, Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useUserStore } from '@/stores/user.store'
import { useSettingsStore } from '@/stores/settings.store'
import { useChatStore } from '@/stores/chat.store'
import { useAnalysisStore } from '@/stores/analysis.store'
import { chatStorage } from '@/stores/storage/chat'
import { getProfileApi, resolveAvatar } from '@/services/user'
import { modelApi } from '@/services/model.api'
import { clearLocalCache } from '@/utils/cache'
import { clearAllAuth } from '@/utils/auth'
import {
  stopActiveStream,
  useChatController,
} from '@/controllers/chat.controller'
import ModelPickerPopup from '@/components/common/ModelPickerPopup'
import { AI_MODELS } from '@repo/types'
import type { ModelListItem } from '@repo/types'
import './index.scss'

const APP_VERSION = '1.0.0'

export default function UserPage() {
  const userInfo = useUserStore((s) => s.userInfo)
  const setUserInfo = useUserStore((s) => s.setUserInfo)
  const defaultModel = useSettingsStore((s) => s.defaultModel)
  const showThinking = useSettingsStore((s) => s.showThinking)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const setShowThinking = useSettingsStore((s) => s.setShowThinking)

  const [pickerVisible, setPickerVisible] = useState(false)

  // 取聊天控制器（仅用其 switchModel 联动当前会话模型；hook 无副作用）
  const { switchModel } = useChatController()

  // Model list: start with built-in models as fallback, then fetch merged list
  const [models, setModels] = useState<ModelListItem[]>(
    AI_MODELS.map((m) => ({
      id: m.id,
      displayName: m.id,
      protocolType: undefined,
      provider: m.provider,
      supportsThinking: m.supportsThinking,
      source: 'builtin' as const,
    })),
  )

  const authReady = useUserStore((state) => state.authReady)

  const fetchModels = useCallback(async () => {
    try {
      const res = await modelApi.listModels()
      if (res.models?.length > 0) {
        setModels(res.models)
        // 默认模型若指向已删除的模型，回退系统默认并更新 storage
        useSettingsStore.getState().ensureDefaultModelValid(res.models)
      }
    } catch (err) {
      // Keep current models (builtin fallback) on error
      console.warn('[UserPage] Failed to fetch models:', err)
    }
  }, [])

  useEffect(() => {
    if (authReady) {
      fetchModels()
    }
  }, [authReady, fetchModels])

  // 每次进入页面拉取最新资料（401 由 request.ts 自动登出；网络错误保留旧数据）
  const loadProfile = useCallback(async () => {
    try {
      const profile = await getProfileApi()
      setUserInfo({
        id: profile.id,
        username: profile.username,
        email: profile.email,
        avatar: resolveAvatar(profile.avatar),
      })
    } catch {
      // 静默失败 — 保留 store 中的已有数据
    }
  }, [setUserInfo])

  useDidShow(() => {
    loadProfile()
  })

  const onBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  // ── 默认模型 / 思考过程偏好 ───────────────────────────

  const handleDefaultModelConfirm = (model: string) => {
    setDefaultModel(model)
    // 联动「分析」模块：切换其当前使用的模型
    useAnalysisStore.getState().setModel(model)
    // 联动「对话」模块：有当前会话时切换其模型；
    // 无当前会话时不新建（新会话已实时读取默认值）
    const chatState = useChatStore.getState()
    if (chatState.currentSessionId && chatState.currentSessionMeta) {
      switchModel(model)
    }
    setPickerVisible(false)
    Taro.showToast({ title: '默认模型已更新', icon: 'success' })
  }

  const handleThinkingChange = (e: any) => {
    setShowThinking(e.detail.value)
  }

  const handleTheme = () => {
    // TODO: 主题切换（跟随系统 / 浅色 / 深色），接入 CSS 变量体系
  }

  const handleLanguage = () => {
    // TODO: 语言切换（简体中文 / English）
  }

  const handleAgreement = () => {
    // TODO: 用户协议页面
  }

  const handlePrivacy = () => {
    // TODO: 隐私政策页面
  }

  // ── 模型管理 ────────────────────────────────────────────

  const goModelManagement = () => {
    Taro.navigateTo({ url: '/pages/model/index' })
  }

  // ── 清除缓存 ────────────────────────────────────────────

  const handleClearCache = () => {
    Taro.showModal({
      title: '清除缓存',
      content:
        '将清除：临时缓存、图片缓存、本地草稿。\n不会删除：登录状态、对话历史、分析结果、云端模型、用户资料。',
      confirmText: '清除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        clearLocalCache()
        Taro.showToast({ title: '缓存已清除', icon: 'success' })
      },
    })
  }

  // ── 退出登录 ────────────────────────────────────────────

  const handleLogout = () => {
    Taro.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？将清除本机登录状态与本地数据。',
      confirmText: '退出',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return
        try {
          // 1. 中断进行中的聊天 SSE（防止流回调写回旧数据）
          stopActiveStream()
          // 2. 删除 Access / Refresh Token
          await clearAllAuth()
          // 3. UserStore 清空
          useUserStore.getState().logout()
          // 4. Chat Store 重置 + 本地会话缓存清空（防止跨账号串状态）
          useChatStore.getState().reset()
          chatStorage.clearAll()
          // 5. 分析内存状态清空
          useAnalysisStore.getState().reset()
          Taro.reLaunch({ url: '/pages/login/index' })
        } catch {
          Taro.showToast({ title: '退出失败', icon: 'none' })
        }
      },
    })
  }

  return (
    <View className='user-page'>
      <AppHeader title='用户设置' onBack={onBack} />

      {/* 个人资料 */}
      <View className='user-card'>
        <View className='user-card__avatar'>
          {userInfo?.avatar ? (
            <Image
              className='user-card__avatar-img'
              src={userInfo.avatar}
              mode='aspectFill'
            />
          ) : (
            <Icon name='touxiang' size={88} color={IconColors.secondary} />
          )}
        </View>
        <View className='user-card__info'>
          <Text className='user-card__name'>
            {userInfo?.username || '未登录'}
          </Text>
          <Text className='user-card__email'>{userInfo?.email || '--'}</Text>
        </View>
        <View
          className='user-card__edit'
          onClick={() => Taro.navigateTo({ url: '/pages/profile/index' })}
        >
          <Icon name='bianji' size={36} color={IconColors.secondary} />
        </View>
      </View>

      {/* AI 设置 */}
      <View className='setting-section'>
        <Text className='setting-section__label'>AI 设置</Text>
        <View className='setting-card'>
          <View
            className='setting-row'
            onClick={() => setPickerVisible(true)}
          >
            <Text className='setting-row__label'>默认模型</Text>
            <View className='setting-row__right'>
              <Text className='setting-row__value'>
                {models.find((m) => m.id === defaultModel)?.displayName ||
                  defaultModel}
              </Text>
              <Icon name='qianjin' size={28} color={IconColors.secondary} />
            </View>
          </View>
          <View className='setting-row' onClick={goModelManagement}>
            <Text className='setting-row__label'>模型管理</Text>
            <View className='setting-row__right'>
              <Icon name='qianjin' size={28} color={IconColors.secondary} />
            </View>
          </View>
          <View className='setting-row'>
            <Text className='setting-row__label'>显示思考过程</Text>
            <View className='setting-row__right'>
              <Switch
                checked={showThinking}
                onChange={handleThinkingChange}
                color='#117C0D'
              />
            </View>
          </View>
        </View>
      </View>

      {/* 应用设置 */}
      <View className='setting-section'>
        <Text className='setting-section__label'>应用设置</Text>
        <View className='setting-card'>
          <View className='setting-row' onClick={handleTheme}>
            <Text className='setting-row__label'>主题</Text>
            <View className='setting-row__right'>
              <Text className='setting-row__value'>跟随系统</Text>
              <Icon name='qianjin' size={28} color={IconColors.secondary} />
            </View>
          </View>
          <View className='setting-row' onClick={handleLanguage}>
            <Text className='setting-row__label'>语言</Text>
            <View className='setting-row__right'>
              <Text className='setting-row__value'>简体中文</Text>
              <Icon name='qianjin' size={28} color={IconColors.secondary} />
            </View>
          </View>
        </View>
      </View>

      {/* 数据与隐私 */}
      <View className='setting-section'>
        <Text className='setting-section__label'>数据与隐私</Text>
        <View className='setting-card'>
          <View className='setting-row' onClick={handleClearCache}>
            <Text className='setting-row__label'>清除缓存</Text>
            <View className='setting-row__right'>
              <Icon name='qianjin' size={28} color={IconColors.secondary} />
            </View>
          </View>
        </View>
      </View>

      {/* 关于 */}
      <View className='setting-section'>
        <Text className='setting-section__label'>关于</Text>
        <View className='setting-card'>
          <View className='setting-row'>
            <Text className='setting-row__label'>版本</Text>
            <View className='setting-row__right'>
              <Text className='setting-row__value'>一叶 {APP_VERSION}</Text>
            </View>
          </View>
          <View className='setting-row' onClick={handleAgreement}>
            <Text className='setting-row__label'>用户协议</Text>
            <View className='setting-row__right'>
              <Icon name='qianjin' size={28} color={IconColors.secondary} />
            </View>
          </View>
          <View className='setting-row' onClick={handlePrivacy}>
            <Text className='setting-row__label'>隐私政策</Text>
            <View className='setting-row__right'>
              <Icon name='qianjin' size={28} color={IconColors.secondary} />
            </View>
          </View>
        </View>
      </View>

      {/* 退出登录 */}
      <View className='logout-btn' onClick={handleLogout}>
        <Text className='logout-btn__text'>退出登录</Text>
      </View>

      {/* 默认模型选择弹窗 */}
      <ModelPickerPopup
        visible={pickerVisible}
        currentModel={defaultModel}
        models={models}
        onCancel={() => setPickerVisible(false)}
        onConfirm={handleDefaultModelConfirm}
      />
    </View>
  )
}
