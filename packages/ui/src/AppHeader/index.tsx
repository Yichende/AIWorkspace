import { View, Text } from '@tarojs/components'
import { CSSProperties } from 'react'
import Icon from '../Icon'
import './index.scss'

/** 默认图标色值，消费端可通过 CSS 变量覆盖 */
const ICON_COLORS = {
  back: '#FAC75E',   // accent
  secondary: '#117C0D',
  title: '#1B1B1B',
} as const

export interface AppHeaderProps {
  /** 页面标题，居中显示 */
  title: string
  /** 返回按钮点击 */
  onBack?: () => void
  /** 是否显示返回按钮，默认 true */
  showBack?: boolean
  /** 返回按钮图标名称（Icon name），默认 'fanhui' */
  backIcon?: string
  /** 左侧额外操作区（在返回按钮右侧） */
  leftActions?: React.ReactNode
  /** 右侧操作区 */
  rightAction?: React.ReactNode
  /** 自定义样式 */
  style?: CSSProperties
  /** 自定义类名 */
  className?: string
}

/**
 * AppHeader — 通用顶部导航栏
 *
 * 布局: [back | leftActions] ── [title] ── [rightAction]
 *
 * 用于所有 `navigationStyle: 'custom'` 的页面。
 * 包含 status-bar-placeholder 适配系统状态栏高度。
 */
export default function AppHeader({
  title,
  onBack,
  showBack = true,
  backIcon = 'fanhui',
  leftActions,
  rightAction,
  style,
  className,
}: AppHeaderProps) {
  const cls = ['app-header', className].filter(Boolean).join(' ')

  return (
    <View className={cls} style={style}>
      {/* 状态栏占位（自定义导航栏时需手动处理） */}
      <View className='app-header__status-bar' />

      <View className='app-header__title-row'>
        {/* 左侧区域 */}
        <View className='app-header__left'>
          {showBack && (
            <View className='app-header__btn' onClick={onBack}>
              <Icon name={backIcon} size={46} color={ICON_COLORS.back} />
            </View>
          )}
          {leftActions}
        </View>

        {/* 标题 */}
        <Text className='app-header__title'>{title}</Text>

        {/* 右侧区域 */}
        <View className='app-header__right'>
          {rightAction}
        </View>
      </View>
    </View>
  )
}
