import { View } from '@tarojs/components'
import { useCallback, useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { AppHeader } from '@my/ui'
import ModelSwitcher from '@/components/common/ModelSwitcher'
import { modelApi } from '@/services/model.api'
import { useUserStore } from '@/stores/user.store'
import { useChatStore } from '@/stores/chat.store'
import { useAnalysisStore } from '@/stores/analysis.store'
import { useChatController } from '@/controllers/chat.controller'
import { AI_MODELS } from '@repo/types'
import { DEFAULT_MODEL } from '@repo/constants'
import type { ModelListItem } from '@repo/types'
import './index.scss'

type ModelTab = 'chat' | 'analysis'

export default function ModelPage() {
  // 当前 Tab（对话 / 分析）— 页内 UI 状态
  const [tab, setTab] = useState<ModelTab>('chat')

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

  // 等待 auth 初始化完成再发起 API 调用，避免启动竞态导致 401
  const authReady = useUserStore((state) => state.authReady)

  const fetchModels = useCallback(async () => {
    try {
      const res = await modelApi.listModels()
      if (res.models?.length > 0) {
        setModels(res.models)
      }
    } catch (err) {
      // Keep current models (builtin fallback) on error
      console.warn('[ModelPage] Failed to fetch models:', err)
    }
  }, [])

  useEffect(() => {
    if (authReady) {
      fetchModels()
    }
  }, [authReady, fetchModels])

  // 从 addModel 页返回时刷新
  useDidShow(() => {
    fetchModels()
  })

  // ── 跨模块模型状态绑定（不写本地假状态） ──────────────

  // 对话模块：当前会话的模型
  const chatModel = useChatStore(
    (s) => s.currentSessionMeta?.model ?? DEFAULT_MODEL,
  )
  const { switchModel } = useChatController()

  // 分析模块：分析流程使用的模型
  const analysisModel = useAnalysisStore((s) => s.model)
  const setAnalysisModel = useAnalysisStore((s) => s.setModel)

  // ── Handlers（两个 Tab 共用） ──────────────────────────

  const onBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  const handleAddModel = () => {
    Taro.navigateTo({ url: '/pages/addModel/index' })
  }

  const handleEditModel = (modelId: string) => {
    const model = models.find((m) => m.id === modelId)
    const source = model?.source ?? 'custom'
    Taro.navigateTo({
      url: `/pages/addModel/index?modelId=${modelId}&source=${source}`,
    })
  }

  const handleDeleteModel = async (modelId: string) => {
    try {
      await modelApi.deleteModel(modelId)
      Taro.showToast({ title: '模型已删除', icon: 'success' })
      fetchModels()
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' })
    }
  }

  return (
    <View className='model-page'>
      <AppHeader title='模型管理' onBack={onBack} />

      <View className='model-page__content'>
        {/* 分段 Tabs：分别管理对话 / 分析两个模块的模型 */}
        <View className='model-page__tabs'>
          <View
            className={`model-page__tab ${tab === 'chat' ? 'active' : ''}`}
            onClick={() => setTab('chat')}
          >
            对话
          </View>
          <View
            className={`model-page__tab ${tab === 'analysis' ? 'active' : ''}`}
            onClick={() => setTab('analysis')}
          >
            分析
          </View>
        </View>

        {tab === 'chat' ? (
          <ModelSwitcher
            models={models}
            currentModel={chatModel}
            onModelChange={switchModel}
            onAddModel={handleAddModel}
            onEditModel={handleEditModel}
            onDeleteModel={handleDeleteModel}
          />
        ) : (
          <ModelSwitcher
            models={models}
            currentModel={analysisModel}
            onModelChange={setAnalysisModel}
            onAddModel={handleAddModel}
            onEditModel={handleEditModel}
            onDeleteModel={handleDeleteModel}
          />
        )}
      </View>
    </View>
  )
}
