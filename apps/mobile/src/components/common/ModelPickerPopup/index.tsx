import { View, Text, ScrollView } from '@tarojs/components'
import { useEffect, useState } from 'react'
import { Popup } from '@nutui/nutui-react-taro'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { useSettingsStore } from '@/stores/settings.store'
import type { ModelListItem } from '@repo/types'

import './index.scss'

interface Props {
  visible: boolean
  /** 当前默认模型 id（打开时作为草稿初值） */
  currentModel: string
  models: ModelListItem[]
  onCancel: () => void
  /** 确认才生效：由调用方持久化并写入 settings */
  onConfirm: (model: string) => void
}

/**
 * ModelPickerPopup — 默认模型选择弹窗（居中）。
 * 内部维护 draft 选择状态；取消/点遮罩丢弃，确认后才回调写入。
 */
export default function ModelPickerPopup({
  visible,
  currentModel,
  models,
  onCancel,
  onConfirm,
}: Props) {
  // 弹层内容在 NutUI Popup（小程序端自定义组件）内，需在根节点挂主题类
  // 让随页面 wxss 输出的 .theme-* 变量规则在组件内匹配（变量不跨组件边界）
  const theme = useSettingsStore((s) => s.theme)
  const [draftModel, setDraftModel] = useState(currentModel)

  // 每次打开时把草稿重置为当前默认模型
  useEffect(() => {
    if (visible) {
      setDraftModel(currentModel)
    }
  }, [visible, currentModel])

  return (
    <Popup
      visible={visible}
      position='center'
      onClose={onCancel}
      closeOnOverlayClick
      zIndex={2000}
    >
      <View className={`model-picker theme-${theme}`}>
        <Text className='model-picker__title'>选择默认模型</Text>

        {/* 列表超高时上下滚动（约 7 行内不滚） */}
        <ScrollView
          scrollY
          showScrollbar={false}
          className='model-picker__list'
        >
          {models.map((m) => {
            const active = draftModel === m.id
            return (
              <View
                key={m.id}
                className={`model-picker__item ${active ? 'active' : ''}`}
                onClick={() => setDraftModel(m.id)}
              >
                <Text className='model-picker__name'>{m.displayName}</Text>
                {m.source === 'custom' && (
                  <Text className='model-picker__tag'>自定义</Text>
                )}
                {active && (
                  <Icon
                    name='chenggong'
                    size={32}
                    color={IconColors.secondary}
                  />
                )}
              </View>
            )
          })}
        </ScrollView>

        <View className='model-picker__actions'>
          <View className='model-picker__btn cancel' onClick={onCancel}>
            <Text>取消</Text>
          </View>
          <View
            className='model-picker__btn confirm'
            onClick={() => onConfirm(draftModel)}
          >
            <Text>确认</Text>
          </View>
        </View>
      </View>
    </Popup>
  )
}
