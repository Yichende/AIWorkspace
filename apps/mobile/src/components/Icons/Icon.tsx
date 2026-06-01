import Taro from '@tarojs/taro'
import { Image } from '@tarojs/components'

import { icons } from './data'
import { getSvgCache } from './cache'

import type { IconProps } from './types'

export function Icon({
  name,
  size = 24,
  color = '#117C0D',
}: IconProps) {
  const icon = icons[name]

  if (!icon) {
    return null
  }

  const env = Taro.getEnv()

  if (env === Taro.ENV_TYPE.WEAPP) {
    const cacheKey =
      `${name}-${size}-${color}`

    const src = getSvgCache(
      cacheKey,
      () => {
        const svg = `
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="${icon.viewBox}"
        >
          ${icon.paths
            .map(
              path =>
                `<path d="${path}" fill="${color}" />`
            )
            .join('')}
        </svg>
      `

        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
      }
    )

    return (
      <Image
        src={src}
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
    >
      {icon.paths.map(
        (path, index) => (
          <path
            key={index}
            d={path}
            fill={color}
          />
        )
      )}
    </svg>
  )
}