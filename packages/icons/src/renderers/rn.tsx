import Svg, { Path } from 'react-native-svg'
import React from 'react'
import type { RendererProps } from '../types'

export function renderRN({
  icon,
  size,
  color
}: RendererProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
    >
      {icon.paths.map((path, index) => (
        <Path
          key={index}
          d={path}
          fill={color}
        />
      ))}
    </Svg>
  )
}