import { View, Text, Input } from '@tarojs/components'
import { useState, useEffect, useMemo } from 'react'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import type { ChatHistoryGroup } from '@/stores/chat.store'
import type { ModelListItem } from '@repo/types'

interface Props {
  groups: ChatHistoryGroup[]
  hasMore: boolean
  loading: boolean
  currentSessionId: string | null
  models?: ModelListItem[]
  onSelect: (id: string) => void
  onRename?: (id: string, newTitle: string) => void
  onDelete?: (id: string) => void
  onLoadMore?: () => void
}

export default function ChatHistoryList({
  groups,
  hasMore,
  loading,
  currentSessionId,
  models,
  onSelect,
  onRename,
  onDelete,
  onLoadMore,
}: Props) {
  // modelId → displayName 查找表
  const modelNameMap = useMemo(() => {
    if (!models?.length) return {} as Record<string, string>
    const map: Record<string, string> = {}
    for (const m of models) {
      map[m.id] = m.displayName
    }
    return map
  }, [models])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [popoverId, setPopoverId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Close popover when clicking outside
  useEffect(() => {
    if (!popoverId) return
    const timer = setTimeout(() => {
      // Auto-close popover if clicking elsewhere (handled via onBlur-like behavior)
    }, 100)
    return () => clearTimeout(timer)
  }, [popoverId])

  if (!groups.length && !loading) {
    return (
      <View className='history-empty'>
        <Icon name='duihuoxiaoxi' size={64} color={IconColors.secondary} />
        <Text className='empty-text'>暂无对话记录</Text>
      </View>
    )
  }

  const handlePopoverAction = (action: 'rename' | 'delete', id: string, title: string) => {
    setPopoverId(null)
    if (action === 'rename') {
      setEditingId(id)
      setEditValue(title)
    } else {
      setConfirmDeleteId(id)
    }
  }

  const handleConfirmDelete = () => {
    if (confirmDeleteId) {
      onDelete?.(confirmDeleteId)
      setConfirmDeleteId(null)
    }
  }

  /** Confirm rename on blur or enter */
  const handleRenameConfirm = () => {
    if (editingId && editValue.trim()) {
      onRename?.(editingId, editValue.trim())
    }
    setEditingId(null)
    setEditValue('')
  }

  return (
    <View className='chat-history-list'>
      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <View className='popover-overlay' onClick={() => setConfirmDeleteId(null)}>
          <View className='confirm-dialog' onClick={(e) => e.stopPropagation()}>
            <Text className='confirm-title'>确认删除</Text>
            <Text className='confirm-content'>删除后无法恢复</Text>
            <View className='confirm-actions'>
              <View className='confirm-btn cancel' onClick={() => setConfirmDeleteId(null)}>
                <Text>取消</Text>
              </View>
              <View className='confirm-btn danger' onClick={handleConfirmDelete}>
                <Text>删除</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {groups.map((group) => (
        <View key={group.group} className='history-group'>
          <Text className='group-label'>{group.label}</Text>

          {group.items.map((item) => (
            <View
              key={item.id}
              className={`history-item ${item.id === currentSessionId ? 'history-item-active' : ''}`}
            >
              {/* Main content area — selects the conversation */}
              <View
                className='history-item-content'
                onClick={() => {
                  if (editingId !== item.id) {
                    onSelect(item.id)
                  }
                }}
              >
                {editingId === item.id ? (
                  <Input
                    className='history-item-edit-input'
                    value={editValue}
                    focus
                    onInput={(e) => setEditValue(e.detail.value)}
                    onBlur={handleRenameConfirm}
                    onConfirm={handleRenameConfirm}
                  />
                ) : (
                  <>
                    <Text className='history-item-title'>{item.title}</Text>
                    <Text className='history-item-model'>
                      {modelNameMap[item.model] || item.model}
                    </Text>
                  </>
                )}
              </View>

              {/* More options button */}
              {editingId !== item.id && (
                <View className='history-item-more-wrapper'>
                  <View
                    className='history-item-more'
                    onClick={(e) => {
                      e.stopPropagation()
                      setPopoverId(popoverId === item.id ? null : item.id)
                    }}
                  >
                    <Icon name='gengduo' size={32} color={IconColors.secondary} />
                  </View>

                  {/* Popover menu */}
                  {popoverId === item.id && (
                    <View className='history-popover'>
                      <View
                        className='popover-item'
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePopoverAction('rename', item.id, item.title)
                        }}
                      >
                        <Icon name='bianji' size={28} color={IconColors.secondary} />
                        <Text className='popover-item-text'>更改标题</Text>
                      </View>
                      <View className='popover-divider' />
                      <View
                        className='popover-item popover-item-danger'
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePopoverAction('delete', item.id, item.title)
                        }}
                      >
                        <Icon name='shanchu' size={28} color='#E65050' />
                        <Text className='popover-item-text popover-item-text-danger'>删除对话</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      ))}

      {/* Load more sessions */}
      {hasMore && (
        <View
          className='history-load-more'
          onClick={loading ? undefined : onLoadMore}
        >
          {loading ? (
            <View className='load-more-loading'>
              <View className='loading-dots'>
                <View className='dot' />
                <View className='dot' />
                <View className='dot' />
              </View>
            </View>
          ) : (
            <Text className='load-more-text'>加载更多</Text>
          )}
        </View>
      )}
    </View>
  )
}
