import { View, Text, Textarea } from '@tarojs/components'
import { useState } from 'react'
import type { DatasetSummary } from '@repo/types'
import './index.scss'

interface Props {
  dataset: DatasetSummary
  model: string
  onModelChange: (model: string) => void
  onSubmit: (prompt: string) => void
  onBack: () => void
}

const TEMPLATES = [
  { label: '销售趋势分析', prompt: '分析销售趋势，找出增长和下降的关键时期，对比不同维度（如有）的表现差异。' },
  { label: '用户画像分析', prompt: '分析用户特征分布，识别核心用户群体，给出用户分层建议。' },
  { label: '利润分析', prompt: '分析利润构成和变化趋势，找出影响利润的关键因素，给出优化建议。' },
  { label: '异常数据检测', prompt: '检测数据中的异常值和异常模式，分析可能的产生原因。' },
]

export default function AnalysisPrompt({
  dataset,
  model: _model,
  onModelChange: _onModelChange,
  onSubmit,
}: Props) {
  const [inputValue, setInputValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = () => {
    const prompt = inputValue.trim()
    if (!prompt) return
    setSubmitting(true)
    onSubmit(prompt)
  }

  const handleTemplate = (template: (typeof TEMPLATES)[0]) => {
    setInputValue(template.prompt)
  }

  const canSubmit = inputValue.trim().length > 0 && !submitting

  return (
    <View className='prompt-step'>
      <View className='prompt-step__header'>
        <Text className='prompt-step__title'>描述分析需求</Text>
        <Text className='prompt-step__subtitle'>
          已加载数据：{dataset.rowCount} 行 × {dataset.columnCount} 列
          （{dataset.columns.slice(0, 5).join('、')}{dataset.columns.length > 5 ? '...' : ''}）
        </Text>
      </View>

      {/* 输入框 */}
      <View className='prompt-step__input-wrap'>
        <Textarea
          className='prompt-step__input'
          value={inputValue}
          onInput={(e) => setInputValue(e.detail.value)}
          placeholder='请描述你希望分析什么数据？例如：分析最近一年销售趋势，找出销量下降原因'
          placeholderStyle='color: #9B9B9B; font-size: 28rpx;'
          maxlength={1000}
          autoHeight
          focus
        />
        <Text className='prompt-step__counter'>
          {inputValue.length}/1000
        </Text>
      </View>

      {/* 快捷模板 */}
      <View className='prompt-step__templates'>
        <Text className='prompt-step__templates-label'>快捷模板</Text>
        <View className='prompt-step__templates-row'>
          {TEMPLATES.map((tpl) => (
            <View
              key={tpl.label}
              className='prompt-step__template'
              onClick={() => handleTemplate(tpl)}
            >
              <Text>{tpl.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 提交按钮 */}
      <View className='prompt-step__actions'>
        <View
          className={`prompt-step__btn ${canSubmit ? '' : 'prompt-step__btn--disabled'}`}
          onClick={canSubmit ? handleSubmit : undefined}
        >
          <Text>
            {submitting ? '正在创建分析任务...' : '开始分析'}
          </Text>
        </View>
      </View>
    </View>
  )
}
