import Taro from '@tarojs/taro'

import { icons } from './data'

import type { IconProps } from './types'

import { renderWeapp } from './renderers/weapp'
import { renderH5 } from './renderers/h5'
import { renderRN } from './renderers/rn'

export function Icon({ name, size = 24, color = '#333' }: IconProps) {
  const icon = icons[name]

  if (!icon) {
    return null
  }

  const env = Taro.getEnv()

  switch (env) {
    case Taro.ENV_TYPE.WEAPP:
      return renderWeapp({
        icon,
        size,
        color,
      })

    case Taro.ENV_TYPE.WEB:
      return renderH5({
        icon,
        size,
        color,
      })

    default:
      return renderRN({
        icon,
        size,
        color,
      })
  }
}
