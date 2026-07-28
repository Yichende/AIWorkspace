import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import { Popup } from '@nutui/nutui-react-taro'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useUserStore } from '@/stores/user.store'
import type { ChatHistoryGroup } from '@/stores/chat.store'
import type { ModelListItem } from '@repo/types'

import Taro from '@tarojs/taro'
import ChatHistoryList from './ChatHistoryList'

import './index.scss'

const MAX_SELECT = 20

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
  onBatchDelete?: (ids: string[]) => void
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
  onBatchDelete,
}: Props) {
  const userInfo = useUserStore((state) => state.userInfo)
  const modelTestResults = useUserStore((state) => state.modelTestResults)
  const [modelExpanded, setModelExpanded] = useState(false)
  const [modelPopoverId, setModelPopoverId] = useState<string | null>(null)
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState<string | null>(null)

  // 菜单关闭时重置 model list 折叠状态
  useEffect(() => {
    if (!visible) {
      setModelExpanded(false)
      setModelPopoverId(null)
      setConfirmDeleteModelId(null)
    }
  }, [visible])

  // ── Batch management ──
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmBatchVisible, setConfirmBatchVisible] = useState(false)
  const [confirmCountdown, setConfirmCountdown] = useState(3)

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

  // ── Batch mode handlers ──

  /** 进入批量管理模式 */
  const enterBatchMode = () => {
    setBatchMode(true)
    setSelectedIds([])
  }

  /** 切换选中状态（上限 MAX_SELECT） */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id)
      if (prev.length >= MAX_SELECT) return prev
      return [...prev, id]
    })
  }

  /** 取消批量管理模式 */
  const cancelBatch = () => {
    setBatchMode(false)
    setSelectedIds([])
  }

  /** 打开确认弹窗，启动倒计时 */
  const openConfirmDialog = () => {
    if (selectedIds.length === 0) return
    setConfirmCountdown(3)
    setConfirmBatchVisible(true)
  }

  /** 倒计时 tick，归零后停止等待用户手动点击 */
  useEffect(() => {
    if (!confirmBatchVisible) return
    if (confirmCountdown <= 0) return  // 倒计时结束，等待用户点击
    const timer = setTimeout(() => setConfirmCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [confirmBatchVisible, confirmCountdown])

  /** 确认批量删除 */
  const confirmBatchDelete = () => {
    onBatchDelete?.(selectedIds)
    setConfirmBatchVisible(false)
    setBatchMode(false)
    setSelectedIds([])
  }

  return (
    <Popup
      visible={visible}
      position='left'
      onClose={onClose}
      closeOnOverlayClick
      zIndex={2000}
    >
      <View className={`chat-menu ${batchMode ? 'batch-mode' : ''}`}>
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

            <ScrollView
              className={`model-list ${modelExpanded ? 'model-list--expanded' : ''}`}
              scrollY
              showScrollbar={false}
            >
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
                    <View
                      className={`model-status-dot ${
                        (
                          option.lastTestAvailable === false ||
                          modelTestResults[option.id] === false
                        )
                          ? 'model-status-dot--error'
                          : ''
                      }`}
                    />

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
            </ScrollView>
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
            batchMode={batchMode}
            selectedIds={selectedIds}
            onSelect={handleHistorySelect}
            onRename={onRenameChat}
            onDelete={onDeleteChat}
            onLoadMore={onLoadMoreSessions}
            onEnterBatchMode={enterBatchMode}
            onToggleSelect={toggleSelect}
          />
        </ScrollView>

        {/* ========== 用户模块（正常模式）/ 批量操作栏（批量模式）========== */}
        {batchMode ? (
          <View className='menu-batch-actions'>
            <View className='batch-btn cancel' onClick={cancelBatch}>
              <Text>取消</Text>
            </View>
            <View
              className={`batch-btn delete ${selectedIds.length === 0 ? 'disabled' : ''}`}
              onClick={openConfirmDialog}
            >
              <Text>删除</Text>
              {selectedIds.length > 0 && (
                <Text className='batch-count'>({selectedIds.length})</Text>
              )}
            </View>
          </View>
        ) : (
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
        )}

        {/* ========== 批量删除确认弹窗（3s 倒计时）========== */}
        {confirmBatchVisible && (
          <View
            className='popover-overlay'
            onClick={() => setConfirmBatchVisible(false)}
          >
            <View className='confirm-dialog' onClick={(e) => e.stopPropagation()}>
              <Text className='confirm-title'>确认批量删除</Text>
              <Text className='confirm-content'>
                将删除选中的 {selectedIds.length} 条对话，删除后无法恢复
              </Text>
              <View className='confirm-actions'>
                <View
                  className='confirm-btn cancel'
                  onClick={() => setConfirmBatchVisible(false)}
                >
                  <Text>取消</Text>
                </View>
                <View
                  className={`confirm-btn danger ${confirmCountdown > 0 ? 'countdown' : ''}`}
                  onClick={confirmCountdown === 0 ? confirmBatchDelete : undefined}
                >
                  <Text>
                    {confirmCountdown > 0 ? `删除(${confirmCountdown}s)` : '删除'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
    </Popup>
  )
}
