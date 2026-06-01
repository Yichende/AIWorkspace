import { Image } from '@tarojs/components'
import type { RendererProps } from '../types'
import { buildSvg } from './buildSvg'
import { getCachedSvg } from '../cache/svgCache'
import React from 'react'

export function renderWeapp({
  icon,
  size,
  color
}: RendererProps) {
  const cacheKey =
    `${icon.viewBox}_${color}_${size}`

  const src = getCachedSvg(
    cacheKey,
    () =>
      `data:image/svg+xml;utf8,${encodeURIComponent(
        buildSvg(icon, color)
      )}`
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