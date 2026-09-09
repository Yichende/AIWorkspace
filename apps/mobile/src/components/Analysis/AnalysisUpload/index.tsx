import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useEffect, useCallback } from 'react'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { analysisApi } from '@/services/analysis.api'
import { modelApi } from '@/services/model.api'
import { useUserStore } from '@/stores/user.store'
import { useSettingsStore } from '@/stores/settings.store'
import ModelSwitcher from '@/components/common/ModelSwitcher'
import { AI_MODELS } from '@repo/types'
import type { DatasetSummary, ModelListItem } from '@repo/types'
import './index.scss'

interface Props {
  model: string
  onModelChange: (model: string) => void
  onUploaded: (
    file: { name: string; size: number },
    fileId: string,
    dataset: DatasetSummary,
  ) => void
}

const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTS = ['.xlsx', '.xls', '.csv']

export default function AnalysisUpload({
  model,
  onModelChange,
  onUploaded,
}: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  // 等待 auth 初始化完成再发起 API 调用，避免启动竞态导致 401
  const authReady = useUserStore((state) => state.authReady)

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

  // Refresh model list on mount and when returning from addModel page
  const fetchModels = useCallback(async () => {
    try {
      const res = await modelApi.listModels()
      if (res.models?.length > 0) {
        setModels(res.models)
        // 对齐 ModelPage/UserPage/ChatPage：默认模型失效（如换号后残留上一账号
        // 的自定义模型 ID）则回退系统默认并更新 storage
        useSettingsStore.getState().ensureDefaultModelValid(res.models)
        // 当前分析流程选中的模型不在列表中（模型被删/属于上一账号）→
        // 回退到已校正的默认模型，避免「切换模型」显示裸 ID、直接分析报模型不存在
        if (!res.models.some((m) => m.id === model)) {
          onModelChange(useSettingsStore.getState().defaultModel)
        }
      }
    } catch (err) {
      // Keep current models (builtin fallback) on error
      console.warn('[AnalysisUpload] Failed to fetch models:', err)
    }
  }, [model, onModelChange])

  useEffect(() => {
    if (authReady) {
      fetchModels()
    }
  }, [authReady, fetchModels])

  useDidShow(() => {
    fetchModels()
  })

  // ── Model management ──

  const handleAddModel = () => {
    Taro.navigateTo({ url: '/pages/addModel/index' })
  }

  const handleEditModel = (modelId: string) => {
    const modelItem = models.find((m) => m.id === modelId)
    const source = modelItem?.source ?? 'custom'
    Taro.navigateTo({
      url: `/pages/addModel/index?modelId=${modelId}&source=${source}`,
    })
  }

  const handleDeleteModel = async (modelId: string) => {
    try {
      await modelApi.deleteModel(modelId)
      Taro.showToast({ title: '模型已删除', icon: 'success' })
      // Refresh model list
      fetchModels()
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' })
    }
  }

  // ── Upload ──

  const handleChooseFile = async () => {
    setError('')

    try {
      const res = await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
      })

      const file = res.tempFiles[0]
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()

      // 格式校验
      if (!ALLOWED_EXTS.includes(ext)) {
        setError('仅支持 .xlsx .xls .csv 格式')
        return
      }

      // 大小校验
      if (file.size > MAX_SIZE) {
        setError('文件大小不能超过 10MB')
        return
      }

      // 上传
      setUploading(true)
      try {
        // file.name 为 chooseMessageFile 返回的原始文件名（哈希串仅存在于
        // 临时路径），显式传给服务端用于落库/展示
        const result = await analysisApi.upload(file.path, file.name, file.name)
        onUploaded(
          { name: file.name, size: file.size },
          result.fileId,
          result.dataset,
        )
      } catch (err: any) {
        setError(err.message || '上传失败，请重试')
      } finally {
        setUploading(false)
      }
    } catch (err: any) {
      if (err.errMsg?.includes('cancel')) return
      setError(err.errMsg || '选择文件失败')
    }
  }

  return (
    <View className='upload-step'>
      <View className='upload-step__header'>
        <Text className='upload-step__title'>上传数据文件</Text>
        <Text className='upload-step__subtitle'>
          支持 Excel (.xlsx/.xls) 和 CSV (.csv) 格式，最大 10MB
        </Text>
      </View>

      {/* 模型切换 */}
      <View className='upload-step__model'>
        <ModelSwitcher
          models={models}
          currentModel={model}
          onModelChange={onModelChange}
          onAddModel={handleAddModel}
          onEditModel={handleEditModel}
          onDeleteModel={handleDeleteModel}
        />
      </View>

      <View className='upload-step__zone' onClick={handleChooseFile}>
        {uploading ? (
          <View className='upload-step__loading'>
            <View className='upload-step__spinner' />
            <Text className='upload-step__loading-text'>正在上传并解析...</Text>
          </View>
        ) : (
          <>
            <Icon
              name='wenjianjia'
              size={80}
              color={IconColors.secondary}
              className='upload-step__icon'
            />
            <Text className='upload-step__cta'>点击选择文件</Text>
            <Text className='upload-step__hint'>
              从聊天记录中选择 Excel 或 CSV 文件
            </Text>
          </>
        )}
      </View>

      {error && (
        <View className='upload-step__error'>
          <Text user-select>{error}</Text>
        </View>
      )}
    </View>
  )
}
