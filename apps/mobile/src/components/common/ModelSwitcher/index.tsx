import { View, Text, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useUserStore } from '@/stores/user.store'
import type { ModelListItem } from '@repo/types'

import './index.scss'

interface Props {
  models: ModelListItem[]
  currentModel: string
  onModelChange: (model: string) => void
  onAddModel: () => void
  onEditModel?: (modelId: string) => void
  onDeleteModel?: (modelId: string) => void
}

/**
 * ModelSwitcher — 可折叠的模型切换组件
 *
 * 与 ChatMenu 中的「切换模型」区块共用同一份代码（自 ChatMenu 提取）。
 * 支持：切换模型、连接状态指示、编辑 / 删除（仅自定义）/ 添加模型。
 */
export default function ModelSwitcher({
  models,
  currentModel,
  onModelChange,
  onAddModel,
  onEditModel,
  onDeleteModel,
}: Props) {
  const modelTestResults = useUserStore((state) => state.modelTestResults)
  const [modelExpanded, setModelExpanded] = useState(false)
  const [modelPopoverId, setModelPopoverId] = useState<string | null>(null)
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState<string | null>(null)

  /** 模型切换 */
  const handleModelChange = (model: string) => {
    onModelChange(model)
    setModelExpanded(false)
  }

  return (
    <View className='model-switcher'>
      {/* 切换模型（可折叠） */}
      <View className='model-toggle-card' onClick={() => setModelExpanded(!modelExpanded)}>
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
            <View className='model-item-main' onClick={() => handleModelChange(option.id)}>
              <Text className='model-item-name'>{option.displayName}</Text>

              {/* 连接状态指示 — 贴近模型名称右侧 */}
              <View
                className={`model-status-dot ${
                  option.lastTestAvailable === false || modelTestResults[option.id] === false
                    ? 'model-status-dot--error'
                    : ''
                }`}
              />

              {option.source === 'custom' && <Text className='model-item-tag'>自定义</Text>}
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
                      setModelPopoverId(modelPopoverId === option.id ? null : option.id)
                    }}
                  >
                    <Icon name='gengduo' size={32} color={IconColors.secondary} />
                  </View>

                  {modelPopoverId === option.id && (
                    <View className='model-popover'>
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

      {/* 删除模型确认弹窗 */}
      {confirmDeleteModelId && (
        <View className='popover-overlay' onClick={() => setConfirmDeleteModelId(null)}>
          <View className='confirm-dialog' onClick={(e) => e.stopPropagation()}>
            <Text className='confirm-title'>确认删除</Text>
            <Text className='confirm-content'>删除后无法恢复，但不影响已有聊天记录</Text>
            <View className='confirm-actions'>
              <View className='confirm-btn cancel' onClick={() => setConfirmDeleteModelId(null)}>
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
    </View>
  )
}
