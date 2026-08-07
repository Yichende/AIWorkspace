import { View } from '@tarojs/components'
import { useMemo } from 'react'
// @gui-one/taro-react-echarts 已内置 echarts，无需额外导入
import { Echarts } from '@gui-one/taro-react-echarts'
import type { ChartConfig } from '@repo/types'
import './index.scss'

interface Props {
  config: ChartConfig
}

/** 将 AI 返回的简化 ChartConfig 映射为 ECharts option */
function chartConfigToOption(config: ChartConfig): any {
  // 如果 AI 返回了 option 覆盖字段，直接使用
  if (config.option) return config.option

  const { type, title, data } = config

  switch (type) {
    case 'line':
    case 'bar': {
      // 从 data 中推断 x 轴字段（第一个非数值字段）和 y 轴字段
      if (data.length === 0) return {}
      const keys = Object.keys(data[0])
      const xKey = keys.find((k) => Number.isNaN(Number(data[0][k]))) || keys[0]
      const yKeys = keys.filter((k) => k !== xKey)

      return {
        title: { text: title, left: 'center' },
        tooltip: { trigger: 'axis' },
        legend: yKeys.length > 1 ? { data: yKeys, bottom: 0 } : undefined,
        grid: {
          left: '3%',
          right: '4%',
          bottom: yKeys.length > 1 ? '10%' : '3%',
          containLabel: true,
        },
        xAxis: { type: 'category', data: data.map((d) => d[xKey]) },
        yAxis: { type: 'value' },
        series: yKeys.map((k) => ({
          name: k,
          type: type,
          data: data.map((d) => Number(d[k]) || 0),
        })),
      }
    }

    case 'pie': {
      // pie data: [{name, value}] 或从通用 data 转换
      const keys = Object.keys(data[0] || {})
      const nameKey = keys.find((k) => Number.isNaN(Number(data[0][k]))) || keys[0]
      const valueKey = keys.find((k) => k !== nameKey) || keys[1]

      return {
        title: { text: title, left: 'center' },
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [
          {
            type: 'pie',
            radius: '60%',
            data: data.map((d) => ({
              name: d[nameKey],
              value: Number(d[valueKey]) || 0,
            })),
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0,0,0,0.5)',
              },
            },
          },
        ],
      }
    }

    default:
      return {}
  }
}

export default function ChartRenderer({ config }: Props) {
  const option = useMemo(() => chartConfigToOption(config), [config])

  return (
    <View className='chart-renderer'>
      <View className='chart-renderer__canvas'>
        <Echarts option={option} isPage={false} />
      </View>
    </View>
  )
}
