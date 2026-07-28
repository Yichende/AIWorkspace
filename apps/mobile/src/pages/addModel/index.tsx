import { View, Text, Input, ScrollView, Switch } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import { modelApi } from '@/services/model.api'
import { useUserStore } from '@/stores/user.store'
import { getModelById } from '@repo/types'
import type {
  ProtocolType,
  CreateUserModelRequest,
} from '@repo/types'

import './index.scss'

const PROTOCOL_OPTIONS: { value: ProtocolType; label: string; desc: string }[] = [
  { value: 'openai_compatible', label: 'OpenAI Compatible', desc: 'DeepSeek、Qwen、Groq 等' },
  { value: 'ollama', label: 'Ollama', desc: '本地 Ollama 或兼容端点' },
  { value: 'anthropic', label: 'Anthropic', desc: 'Anthropic Claude 系列' },
]

export default function AddModelPage() {
  // ── Form state ──
  const [protocolType, setProtocolType] = useState<ProtocolType>('openai_compatible')
  const [provider, setProvider] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiModelName, setApiModelName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [supportsThinking, setSupportsThinking] = useState(false)
  const [notes, setNotes] = useState('')

  // ── UI state ──
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{
    available: boolean
    latency?: number
    error?: string
  } | null>(null)

  // ── Edit mode ──
  const [editModelId, setEditModelId] = useState<string | null>(null)
  const [editSource, setEditSource] = useState<'builtin' | 'custom' | null>(null)

  const isEdit = !!editModelId
  const isBuiltinEdit = editSource === 'builtin'

  useEffect(() => {
    const instance = Taro.getCurrentInstance()
    const modelId = instance.router?.params?.modelId
    const source = instance.router?.params?.source as 'builtin' | 'custom' | undefined
    if (modelId) {
      setEditModelId(modelId)
      setEditSource(source || 'custom')
      loadModelDetail(modelId, source || 'custom')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadModelDetail = async (modelId: string, source: string) => {
    if (source === 'builtin') {
      const builtin = getModelById(modelId)
      if (builtin) {
        setDisplayName(builtin.id)
        setProtocolType(builtin.provider as ProtocolType)
        setApiModelName(builtin.apiModelName ?? builtin.id)
        setSupportsThinking(builtin.supportsThinking)
        setProvider('')
        setApiBaseUrl('')
        setNotes('')
        return
      }
      Taro.showToast({ title: '未找到内置模型信息', icon: 'none' })
      return
    }

    try {
      const model = await modelApi.getModel(modelId)
      setDisplayName(model.displayName)
      setProtocolType(model.protocolType)
      setProvider(model.provider ?? '')
      setApiModelName(model.apiModelName)
      setApiBaseUrl(model.apiBaseUrl ?? '')
      setSupportsThinking(model.supportsThinking)
      setNotes(model.notes ?? '')
    } catch {
      Taro.showToast({ title: '加载模型信息失败', icon: 'none' })
    }
  }

  // ── Handlers ──

  const handleBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  const validate = (): string | null => {
    if (!displayName.trim()) return '请输入模型名称'
    if (displayName.trim().length > 50) return '模型名称最多 50 个字符'
    if (!apiModelName.trim()) return '请输入 API 模型名'
    if (apiBaseUrl.trim() && !/^https?:\/\//.test(apiBaseUrl.trim())) {
      return '请求地址需以 http:// 或 https:// 开头'
    }
    return null
  }

  const handleTest = useCallback(async () => {
    const error = validate()
    if (error) {
      Taro.showToast({ title: error, icon: 'none' })
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const result = await modelApi.testModel({
        protocolType,
        apiModelName: apiModelName.trim(),
        apiKey: apiKey.trim() || undefined,
        apiBaseUrl: apiBaseUrl.trim() || undefined,
      })
      setTestResult(result)

      if (result.available) {
        Taro.showToast({ title: `连接成功 (${result.latency}ms)`, icon: 'success' })
      } else {
        Taro.showToast({ title: result.error || '连接失败', icon: 'none' })
      }
    } catch (err: any) {
      setTestResult({ available: false, error: err.message || '测试失败' })
      Taro.showToast({ title: '测试请求失败', icon: 'none' })
    } finally {
      setTesting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocolType, apiModelName, apiKey, apiBaseUrl, displayName])

  const handleSave = useCallback(async () => {
    const error = validate()
    if (error) {
      Taro.showToast({ title: error, icon: 'none' })
      return
    }

    // Auto-test before save
    if (!testResult) {
      setTesting(true)
      try {
        const result = await modelApi.testModel({
          protocolType,
          apiModelName: apiModelName.trim(),
          apiKey: apiKey.trim() || undefined,
          apiBaseUrl: apiBaseUrl.trim() || undefined,
        })
        setTestResult(result)

        if (!result.available) {
          const confirmed = await new Promise<boolean>((resolve) => {
            Taro.showModal({
              title: '连接测试失败',
              content: `${result.error || '未知错误'}\n\n是否仍然保存？`,
              confirmText: '仍然保存',
              cancelText: '取消',
              success: (res) => resolve(res.confirm),
            })
          })
          if (!confirmed) {
            setTesting(false)
            return
          }
        }
      } finally {
        setTesting(false)
      }
    } else if (!testResult.available) {
      // Already tested and failed — warn
      const confirmed = await new Promise<boolean>((resolve) => {
        Taro.showModal({
          title: '连接测试失败',
          content: `${testResult.error || '未知错误'}\n\n是否仍然保存？`,
          confirmText: '仍然保存',
          cancelText: '取消',
          success: (res) => resolve(res.confirm),
        })
      })
      if (!confirmed) return
    }

    setSaving(true)

    try {
      const data: CreateUserModelRequest = {
        displayName: displayName.trim(),
        protocolType,
        provider: provider.trim() || undefined,
        apiModelName: apiModelName.trim(),
        apiKey: apiKey.trim() || undefined,
        apiBaseUrl: apiBaseUrl.trim() || undefined,
        supportsThinking,
        notes: notes.trim() || undefined,
      }

      let savedModelId: string

      if (isEdit && editModelId && !isBuiltinEdit) {
        // 自定义模型 → 更新
        await modelApi.updateModel(editModelId, data)
        savedModelId = editModelId
        Taro.showToast({ title: '模型已更新', icon: 'success' })
      } else {
        // 内置模型 或 新建 → 创建自定义模型
        const created = await modelApi.createModel(data)
        savedModelId = created.id
        Taro.showToast({ title: '模型已添加', icon: 'success' })
      }

      // 将连接测试结果缓存到内存，用于模型列表的状态指示点
      if (testResult && testResult.available !== undefined) {
        useUserStore
          .getState()
          .setModelTestResult(savedModelId, testResult.available)
      }

      setTimeout(() => Taro.navigateBack({ delta: 1 }), 800)
    } catch (err: any) {
      Taro.showToast({
        title: err?.message || err?.data?.message || '保存失败',
        icon: 'none',
      })
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    displayName, protocolType, provider, apiModelName, apiKey,
    apiBaseUrl, supportsThinking, notes, testResult, isEdit, editModelId,
    isBuiltinEdit,
  ])

  // ── Auto-fill base URL placeholder on protocol change ──
  const getBaseUrlPlaceholder = () => {
    switch (protocolType) {
      case 'ollama': return 'http://localhost:11434'
      case 'openai_compatible': return 'https://api.openai.com/v1'
      case 'anthropic': return 'https://api.anthropic.com'
      default: return ''
    }
  }

  return (
    <View className='add-model-page'>
      {/* Header */}
      <View className='add-model-header'>
        <View className='header-back' onClick={handleBack}>
          <Icon name='fanhui' size={44} color={IconColors.secondary} />
        </View>
        <Text className='header-title'>
          {isBuiltinEdit ? '配置模型' : isEdit ? '编辑模型' : '添加模型'}
        </Text>
        <View className='header-placeholder' />
      </View>

      <ScrollView className='add-model-form' scrollY showScrollbar={false}>
        {/* Protocol Type Selector */}
        <View className='form-section'>
          <Text className='form-label'>接口类型</Text>
          <View className='protocol-options'>
            {PROTOCOL_OPTIONS.map((opt) => (
              <View
                key={opt.value}
                className={`protocol-chip ${protocolType === opt.value ? 'active' : ''}`}
                onClick={() => {
                  setProtocolType(opt.value)
                  setTestResult(null) // reset test result on protocol change
                }}
              >
                <Text className='protocol-chip-label'>{opt.label}</Text>
                <Text className='protocol-chip-desc'>{opt.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Provider Name */}
        <View className='form-section'>
          <Text className='form-label'>供应商名称</Text>
          <Input
            className='form-input'
            placeholder='如：DeepSeek、Groq（选填）'
            placeholderClass='form-placeholder'
            value={provider}
            onInput={(e) => setProvider(e.detail.value)}
            maxlength={50}
          />
        </View>

        {/* Display Name */}
        <View className='form-section'>
          <View className='form-label-row'>
            <Text className='form-label'>模型名称</Text>
            {testResult?.available && (
              <Text className='test-badge success'>✅ 可用 ({testResult.latency}ms)</Text>
            )}
            {testResult && !testResult.available && (
              <Text className='test-badge fail'>❌ 不可用</Text>
            )}
          </View>
          <Input
            className='form-input'
            placeholder='输入模型展示名称'
            placeholderClass='form-placeholder'
            value={displayName}
            onInput={(e) => setDisplayName(e.detail.value)}
            maxlength={50}
          />
        </View>

        {/* API Model Name */}
        <View className='form-section'>
          <Text className='form-label'>API 模型名</Text>
          <Input
            className='form-input'
            placeholder='实际的 API 模型标识，如：deepseek-r1:latest'
            placeholderClass='form-placeholder'
            value={apiModelName}
            onInput={(e) => setApiModelName(e.detail.value)}
            maxlength={100}
          />
        </View>

        {/* API Key */}
        <View className='form-section'>
          <Text className='form-label'>API Key</Text>
          <View className='form-input-wrapper'>
            <Input
              className='form-input form-input-password'
              placeholder={
                isBuiltinEdit
                  ? '输入 API Key 以激活此模型'
                  : isEdit
                    ? '••••••••（不修改则留空）'
                    : '输入 API Key（选填）'
              }
              placeholderClass='form-placeholder'
              password={!showApiKey}
              value={apiKey}
              onInput={(e) => setApiKey(e.detail.value)}
              maxlength={255}
            />
            <View className='form-input-suffix' onClick={() => setShowApiKey(!showApiKey)}>
              <Text className='toggle-text'>{showApiKey ? '隐藏' : '显示'}</Text>
            </View>
          </View>
        </View>

        {/* API Base URL */}
        <View className='form-section'>
          <Text className='form-label'>请求地址</Text>
          <Input
            className='form-input'
            placeholder={getBaseUrlPlaceholder()}
            placeholderClass='form-placeholder'
            value={apiBaseUrl}
            onInput={(e) => setApiBaseUrl(e.detail.value)}
            maxlength={255}
          />
        </View>

        {/* Supports Thinking */}
        <View className='form-section form-section-row'>
          <View className='form-label-group'>
            <Text className='form-label'>支持思考</Text>
            <Text className='form-label-hint'>开启后 AI 回复会显示思考过程</Text>
          </View>
          <Switch
            checked={supportsThinking}
            onChange={(e) => setSupportsThinking(e.detail.value)}
            color='#117C0D'
          />
        </View>

        {/* Notes */}
        <View className='form-section'>
          <Text className='form-label'>备注</Text>
          <Input
            className='form-input form-textarea'
            placeholder='备注信息（选填，最多 500 字）'
            placeholderClass='form-placeholder'
            value={notes}
            onInput={(e) => setNotes(e.detail.value)}
            maxlength={500}
          />
        </View>

        {/* Bottom padding for fixed button */}
        <View style={{ height: 160 }} />
      </ScrollView>

      {/* Bottom Actions */}
      <View className='add-model-actions'>
        <View
          className={`action-btn test-btn ${testing ? 'loading' : ''}`}
          onClick={handleTest}
        >
          <Text className='action-btn-text'>
            {testing ? '测试中...' : '测试连接'}
          </Text>
        </View>
        <View
          className={`action-btn save-btn ${saving ? 'loading' : ''}`}
          onClick={handleSave}
        >
          <Text className='action-btn-text'>
            {saving ? '保存中...' : (isEdit && !isBuiltinEdit ? '更新模型' : '保 存')}
          </Text>
        </View>
      </View>
    </View>
  )
}
