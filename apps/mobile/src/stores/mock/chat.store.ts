/**
 * Mock 聊天历史数据
 *
 * 按时间分组：今天 / 昨天 / 最近一周 / 更早
 */

import type { ChatHistoryGroup } from '@repo/types'

const now = Date.now()
const DAY = 86400000

export const mockChatHistory: ChatHistoryGroup[] = [
  {
    label: '今天',
    group: 'today',
    items: [
      {
        id: '1',
        title: '关于 React 性能优化的讨论',
        createdAt: now - 3600000,
        model: 'DeepSeek-R1',
      },
      {
        id: '2',
        title: 'TypeScript 类型体操练习',
        createdAt: now - 7200000,
        model: 'GPT-4o',
      },
    ],
  },
  {
    label: '昨天',
    group: 'yesterday',
    items: [
      {
        id: '3',
        title: 'NestJS 中间件实现原理',
        createdAt: now - DAY,
        model: 'DeepSeek-V3',
      },
    ],
  },
  {
    label: '最近一周',
    group: 'thisWeek',
    items: [
      {
        id: '4',
        title: 'Taro 多端适配方案',
        createdAt: now - 2 * DAY,
        model: 'Claude 4',
      },
      {
        id: '5',
        title: '数据库索引优化策略',
        createdAt: now - 3 * DAY,
        model: 'DeepSeek-R1',
      },
    ],
  },
  {
    label: '更早',
    group: 'earlier',
    items: [
      {
        id: '6',
        title: 'AI 模型对比分析报告',
        createdAt: now - 7 * DAY,
        model: 'GPT-4o',
      },
      {
        id: '7',
        title: '前端工程化实践总结',
        createdAt: now - 10 * DAY,
        model: 'DeepSeek-V3',
      },
    ],
  },
]
