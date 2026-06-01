export interface IconData {
  viewBox: string
  paths: string[]
}

export interface IconProps {
  name: IconName
  size?: number
  color?: string
}

export type IconName =
  | 'chat'
  | 'table'
  | 'report'
  | 'model'
  | 'arrowRight'