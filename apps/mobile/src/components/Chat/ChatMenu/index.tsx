import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import { Popup } from '@nutui/nutui-react-taro'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useUserStore } from '@/stores/user.store'
import type { ChatHistoryGroup } from '@/stores/chat.store'
import type { ModelListItem } from '@repo/types'

import Taro from '@tarojs/taro'
import ChatHistoryList from './ChatHistoryList'

import './index.scss'

interface Props {
  visible: boolean
  currentModel: string
  currentSessionId: string | null
  historyGroups: ChatHistoryGroup[]
  hasMoreSessions: boolean
  sessionsLoading: boolean
  models: ModelListItem[]
  onClose: () => void
  onModelChange: (model: string) => void
  onAddModel: () => void
  onEditModel?: (modelId: string) => void
  onDeleteModel?: (modelId: string) => void
  onNewChat?: () => void
  onHistorySelect?: (id: string) => void
  onDeleteChat?: (id: string) => void
  onRenameChat?: (id: string, newTitle: string) => void
  onLoadMoreSessions?: () => void
}

export default function ChatMenu({
  visible,
  currentModel,
  currentSessionId,
  historyGroups,
  hasMoreSessions,
  sessionsLoading,
  models,
  onClose,
  onModelChange,
  onAddModel,
  onEditModel,
  onDeleteModel,
  onNewChat,
  onHistorySelect,
  onDeleteChat,
  onRenameChat,
  onLoadMoreSessions,
}: Props) {
  const userInfo = useUserStore((state) => state.userInfo)
  const [modelExpanded, setModelExpanded] = useState(false)
  const [modelPopoverId, setModelPopoverId] = useState<string | null>(null)
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState<string | null>(null)

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
                <Text className='model-current-name'>
                  {models.find((m) => m.id === currentModel)?.displayName || currentModel}
                </Text>
                <Text className={`model-toggle-arrow ${modelExpanded ? 'open' : ''}`}>▼</Text>
              </View>
            </View>

            {modelExpanded && (
              <View className='model-list'>
                {models.map((option) => (
                  <View
                    key={option.id}
                    className={`model-item ${currentModel === option.id ? 'active' : ''}`}
                  >
                    <View
                      className='model-item-main'
                      onClick={() => handleModelChange(option.id)}
                    >
                      <Text className='model-item-name'>{option.displayName}</Text>

                      {/* 连接状态指示 — 贴近模型名称右侧 */}
                      <View className='model-status-dot' />

                      {option.source === 'custom' && (
                        <Text className='model-item-tag'>自定义</Text>
                      )}
                    </View>

                    {/* 操作区：编辑（所有模型）+ 删除（仅自定义） */}
                      <View className='model-item-actions'>
                        <View
                          className='model-item-edit'
                          onClick={(e) => {
                            e.stopPropagation()
                            onEditModel?.(option.id)
                          }}
                        >
                          <Icon name='shezhi' size={32} color={IconColors.secondary} />
                        </View>

                        {/* 删除 — 仅自定义模型可删除 */}
                        {option.source === 'custom' && (
                          <View className='model-item-more-wrapper'>
                            <View
                              className='model-item-more'
                              onClick={(e) => {
                                e.stopPropagation()
                                setModelPopoverId(
                                  modelPopoverId === option.id ? null : option.id,
                                )
                              }}
                            >
                              <Icon name='gengduo' size={32} color={IconColors.secondary} />
                            </View>

                            {modelPopoverId === option.id && (
                              <View className='history-popover model-popover'>
                                <View
                                  className='popover-item popover-item-danger'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setModelPopoverId(null)
                                    setConfirmDeleteModelId(option.id)
                                  }}
                                >
                                  <Icon name='shanchu' size={28} color='#E65050' />
                                  <Text className='popover-item-text popover-item-text-danger'>
                                    删除模型
                                  </Text>
                                </View>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                  </View>
                ))}

                {/* 添加模型入口 — 始终在列表最下方 */}
                <View className='model-item model-item-add' onClick={onAddModel}>
                  <Icon name='tianjia' size={32} color={IconColors.secondary} />
                  <Text className='model-item-name model-add-text'>添加模型</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* 删除模型确认弹窗 */}
        {confirmDeleteModelId && (
          <View
            className='popover-overlay'
            onClick={() => setConfirmDeleteModelId(null)}
          >
            <View className='confirm-dialog' onClick={(e) => e.stopPropagation()}>
              <Text className='confirm-title'>确认删除</Text>
              <Text className='confirm-content'>删除后无法恢复，但不影响已有聊天记录</Text>
              <View className='confirm-actions'>
                <View
                  className='confirm-btn cancel'
                  onClick={() => setConfirmDeleteModelId(null)}
                >
                  <Text>取消</Text>
                </View>
                <View
                  className='confirm-btn danger'
                  onClick={() => {
                    if (confirmDeleteModelId) {
                      onDeleteModel?.(confirmDeleteModelId)
                      setConfirmDeleteModelId(null)
                    }
                  }}
                >
                  <Text>删除</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ========== 对话历史 ========== */}
        <ScrollView className='menu-history' scrollY enhanced showScrollbar={false}>
          <ChatHistoryList
            groups={historyGroups}
            hasMore={hasMoreSessions}
            loading={sessionsLoading}
            currentSessionId={currentSessionId}
            models={models}
            onSelect={handleHistorySelect}
            onRename={onRenameChat}
            onDelete={onDeleteChat}
            onLoadMore={onLoadMoreSessions}
          />
        </ScrollView>

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
