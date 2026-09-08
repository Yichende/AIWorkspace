import { View, Text } from '@tarojs/components'
import { memo } from 'react'
import type { TableConfig } from '@repo/types'
import TableRenderer from '../TableRenderer'
import './index.scss'

interface Props {
  tables: TableConfig[]
}

/** 单个表格块（memo）：流式文本高频更新时不重渲染已生成的表格 */
const TableBlock = memo(function TableBlock({
  config,
}: {
  config: TableConfig
}) {
  return (
    <>
      <Text className='analysis-tables__title'>{config.title}</Text>
      <TableRenderer config={config} />
    </>
  )
})

/** 表格区块（结果页与流式进度页共用） */
export default function AnalysisTables({ tables }: Props) {
  if (!tables || tables.length === 0) return null
  return (
    <View className='analysis-tables'>
      <Text className='analysis-tables__section-title'>数据表格</Text>
      {tables.map((table) => (
        <View key={table.id} className='analysis-tables__wrap'>
          <TableBlock config={table} />
        </View>
      ))}
    </View>
  )
}
