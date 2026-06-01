import type { IconName } from './data'


export interface IconData {
  viewBox: string
  paths: string[]
}

export interface IconProps {
  name: IconName

  size?: number

  color?: string

  className?: string
}

export interface RendererProps {
  icon: IconData
  size: number
  color: string
}