import { View, Text, Image } from '@tarojs/components'
import { useState } from 'react'
import { Popup } from '@nutui/nutui-react-taro'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useUserStore } from '@/stores/user.store'
import { mockChatHistory } from '@/stores/mock/chat.store'

import Taro from '@tarojs/taro'
import ChatHistoryList from './ChatHistoryList'

import './index.scss'

interface Props {
  visible: boolean
  currentModel: string
  onClose: () => void
  onModelChange: (model: string) => void
  onNewChat?: () => void
  onHistorySelect?: (id: string) => void
}

const MODEL_OPTIONS = [
  { key: 'deepseek-r1', name: 'DeepSeek-R1' },
  { key: 'deepseek-v3', name: 'DeepSeek-V3' },
  { key: 'gpt-4o', name: 'GPT-4o' },
  { key: 'claude-4', name: 'Claude 4' },
]

export default function ChatMenu({
  visible,
  currentModel,
  onClose,
  onModelChange,
  onNewChat,
  onHistorySelect,
}: Props) {
  const userInfo = useUserStore((state) => state.userInfo)
  const [modelExpanded, setModelExpanded] = useState(false)

  /** 跳转搜索页 */
  const handleSearch = () => {
    onClose()
    Taro.navigateTo({ url: '/pages/search/index' })
  }

  /** 新建对话 */
  const handleNewChat = () => {
    onClose()
    onNewChat?.()
  }

  /** 选择历史对话 */
  const handleHistorySelect = (id: string) => {
    onClose()
    onHistorySelect?.(id)
  }

  /** 进入个人页 */
  const handleUserProfile = () => {
    onClose()
    // TODO: 待创建用户个人页面后替换路由
    Taro.navigateTo({ url: '/pages/myTest/index' })
  }

  /** 模型切换 */
  const handleModelChange = (model: string) => {
    onModelChange(model)
    setModelExpanded(false)
  }

  return (
    <Popup
      visible={visible}
      position='left'
      onClose={onClose}
      closeOnOverlayClick
      zIndex={2000}
    >
      <View className='chat-menu'>
        {/* ========== 功能区 ========== */}
        <View className='menu-feature'>
          {/* 第一行：App 名称 + 搜索 */}
          <View className='menu-header'>
            <Text className='menu-app-name'>一叶</Text>

            <View className='menu-search-btn' onClick={handleSearch}>
              <Icon name='sousuo' size={40} color={IconColors.secondary} />
            </View>
          </View>

          {/* 第二行：新建对话 */}
          <View className='menu-new-chat' onClick={handleNewChat}>
            <Icon name='tianjia' size={36} color={IconColors.secondary} />
            <Text className='new-chat-text'>新建对话</Text>
          </View>

          {/* 第三行：切换模型（可折叠） */}
          <View className='menu-model-section'>
            <View
              className='model-toggle-card'
              onClick={() => setModelExpanded(!modelExpanded)}
            >
              <View className='model-toggle-left'>
                <Icon name='moxingku' size={34} color={IconColors.secondary} />
                <Text className='model-toggle-label'>切换模型</Text>
              </View>

              <View className='model-toggle-right'>
                <Text className='model-current-name'>{currentModel}</Text>
                <Text className={`model-toggle-arrow ${modelExpanded ? 'open' : ''}`}>▼</Text>
              </View>
            </View>

            {modelExpanded && (
              <View className='model-list'>
                {MODEL_OPTIONS.map((option) => (
                  <View
                    key={option.key}
                    className={`model-item ${currentModel === option.name ? 'active' : ''}`}
                    onClick={() => handleModelChange(option.name)}
                  >
                    <Text className='model-item-name'>{option.name}</Text>

                    {currentModel === option.name && (
                      <Icon name='chenggong' size={32} color={IconColors.secondary} />
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* ========== 对话历史 ========== */}
        <View className='menu-history'>
          <ChatHistoryList groups={mockChatHistory} onSelect={handleHistorySelect} />
        </View>

        {/* ========== 用户模块 ========== */}
        <View className='menu-user' onClick={handleUserProfile}>
          <View className='user-avatar'>
            {userInfo?.avatar ? (
              <Image className='user-avatar-image' src={userInfo.avatar} mode='aspectFill' />
            ) : (
              <Icon name='touxiang' size={44} color={IconColors.secondary} />
            )}
          </View>

          <Text className='user-name'>{userInfo?.username || '未登录'}</Text>

          <View className='user-settings'>
            <Icon name='shezhi' size={36} color={IconColors.secondary} />
          </View>
        </View>
      </View>
    </Popup>
  )
}
