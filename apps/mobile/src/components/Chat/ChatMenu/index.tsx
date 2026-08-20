import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import { Popup } from '@nutui/nutui-react-taro'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useUserStore } from '@/stores/user.store'
import type { ChatHistoryGroup } from '@/stores/chat.store'
import type { ModelListItem } from '@repo/types'

import Taro from '@tarojs/taro'
import ModelSwitcher from '@/components/common/ModelSwitcher'
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
          <ModelSwitcher
            key={String(visible)}
            models={models}
            currentModel={currentModel}
            onModelChange={onModelChange}
            onAddModel={onAddModel}
            onEditModel={onEditModel}
            onDeleteModel={onDeleteModel}
          />
        </View>

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
