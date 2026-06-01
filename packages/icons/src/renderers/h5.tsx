import type { RendererProps } from '../types'
import React from 'react'

export function renderH5({
  icon,
  size,
  color
}: RendererProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="none"
    >
      {icon.paths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill={color}
        />
      ))}
    </svg>
  )
}