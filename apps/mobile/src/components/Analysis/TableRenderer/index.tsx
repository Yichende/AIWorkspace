import { View, Text, ScrollView } from '@tarojs/components'
import type { TableConfig } from '@repo/types'
import './index.scss'

interface Props {
  config: TableConfig
}

/**
 * TableRenderer — 数据表格渲染组件
 *
 * 水平可滚动，支持表头固定样式。
 */
export default function TableRenderer({ config }: Props) {
  const { columns, data } = config

  if (!columns.length || !data.length) {
    return (
      <View className='table-renderer__empty'>
        <Text>无数据</Text>
      </View>
    )
  }

  // 计算列宽：根据内容长度自适应
  const colWidth = Math.max(180, Math.floor(600 / columns.length))

  return (
    <View className='table-renderer'>
      <ScrollView scrollX className='table-renderer__scroll'>
        <View className='table-renderer__table'>
          {/* 表头 */}
          <View className='table-renderer__row table-renderer__header'>
            {columns.map((col) => (
              <View
                key={col}
                className='table-renderer__cell table-renderer__header-cell'
                style={{ width: `${colWidth}rpx` }}
              >
                <Text>{col}</Text>
              </View>
            ))}
          </View>

          {/* 数据行 */}
          {data.map((row, i) => (
            <View key={i} className='table-renderer__row'>
              {columns.map((col) => (
                <View
                  key={col}
                  className='table-renderer__cell'
                  style={{ width: `${colWidth}rpx` }}
                >
                  <Text>{String(row[col] ?? '')}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text className='table-renderer__count'>共 {data.length} 行</Text>
    </View>
  )
}
