import React from 'react'
import { Text, Image } from '@tarojs/components'
import { useMemo } from 'react'
import Taro from '@tarojs/taro'
import './iconfont.css' // 只在需要的端生效，编译时其它端会被摇树

const env = Taro.getEnv()

// 图片资源映射表（仅 RN 端需要）
const ICON_IMAGES: Record<string, string> = {
  // home: new URL('./images/home.png', import.meta.url).href,
  // user: new URL('./images/user.png', import.meta.url).href,
}

interface IconProps {
  name: string
  size?: number
  color?: string
  className?: string
  style?: React.CSSProperties
}

const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = '#333',
  className = '',
  style,
}) => {
  // 统一处理样式
  const baseStyle = useMemo(
    () => ({
      fontSize: `${size}rpx`,
      width: `${size}rpx`,
      height: `${size}rpx`,
      lineHeight: `${size}rpx`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...style,
      color: color,
      ...style,
    }),
    [size, color, style],
  )

  // RN 端使用 Image 组件
  if (env === Taro.ENV_TYPE.RN) {
    const source = ICON_IMAGES[name]
    if (!source) {
      console.warn(`Icon "${name}" not found in RN image map`)
      return null
    }
    return (
      <Image
        src={source}
        style={{
          width: size,
          height: size,
          ...style,
        }}
        className={className}
      />
    )
  }

  // H5 / 小程序使用字体图标
  return (
    <Text className={`iconfont icon-${name} ${className}`} style={baseStyle} />
  )
}

export default Icon
