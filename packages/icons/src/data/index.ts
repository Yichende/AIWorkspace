import { chatIcon } from './chat'
import { tableIcon } from './table'
import { reportIcon } from './report'
import { modelIcon } from './model'

export const icons = {
  chat: chatIcon,
  table: tableIcon,
  report: reportIcon,
  model: modelIcon,
}

export type IconName = keyof typeof icons