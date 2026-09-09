import { View, Text, ScrollView } from '@tarojs/components'
import type { DatasetSummary } from '@repo/types'
import './index.scss'

interface Props {
  file: { name: string; size: number }
  dataset: DatasetSummary
  onContinue: () => void
  onBack: () => void
}

export default function AnalysisPreview({
  file,
  dataset,
  onContinue,
}: Props) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <View className='preview-step'>
      <View className='preview-step__header'>
        <Text className='preview-step__title'>数据预览</Text>
        <Text className='preview-step__subtitle'>确认 AI 正确读取数据后继续分析</Text>
      </View>

      {/* 文件信息 */}
      <View className='preview-step__card'>
        <View className='preview-step__file-icon'>📄</View>
        <View className='preview-step__file-info'>
          <Text className='preview-step__file-name'>{file.name}</Text>
          <Text className='preview-step__file-size'>{formatSize(file.size)}</Text>
        </View>
      </View>

      {/* 数据规模 */}
      <View className='preview-step__stats'>
        <View className='preview-step__stat-item'>
          <Text className='preview-step__stat-value'>{dataset.rowCount}</Text>
          <Text className='preview-step__stat-label'>行</Text>
        </View>
        <View className='preview-step__stat-divider' />
        <View className='preview-step__stat-item'>
          <Text className='preview-step__stat-value'>{dataset.columnCount}</Text>
          <Text className='preview-step__stat-label'>列</Text>
        </View>
      </View>

      {/* 字段列表 */}
      <View className='preview-step__fields'>
        <Text className='preview-step__fields-label'>字段列表：</Text>
        <ScrollView scrollX className='preview-step__fields-scroll'>
          <View className='preview-step__fields-row'>
            {dataset.columns.map((col) => (
              <View key={col} className='preview-step__field-tag'>
                <Text>{col}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* 预览数据（前 3 行） */}
      {dataset.preview.length > 0 && (
        <View className='preview-step__table-wrap'>
          <ScrollView scrollX>
            <View className='preview-step__table'>
              {/* 表头 */}
              <View className='preview-step__table-row preview-step__table-header'>
                {dataset.columns.map((col) => (
                  <View key={col} className='preview-step__table-cell header'>
                    <Text>{col}</Text>
                  </View>
                ))}
              </View>
              {/* 数据行 */}
              {dataset.preview.slice(0, 3).map((row, i) => (
                <View key={i} className='preview-step__table-row'>
                  {dataset.columns.map((col) => (
                    <View key={col} className='preview-step__table-cell'>
                      <Text>{String(row[col] ?? '')}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
          {dataset.rowCount > 3 && (
            <Text className='preview-step__table-hint'>
              仅显示前 3 行，共 {dataset.rowCount} 行
            </Text>
          )}
        </View>
      )}

      {/* 操作按钮 */}
      <View className='preview-step__actions'>
        <View className='preview-step__btn' onClick={onContinue}>
          <Text>继续分析</Text>
        </View>
      </View>
    </View>
  )
}
