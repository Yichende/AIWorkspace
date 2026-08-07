import { View } from '@tarojs/components'
import { AppHeader, Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import './index.scss'

interface Props {
  onBack?: () => void
  onMenu?: () => void
  showBack?: boolean
  showMenu?: boolean
}

/**
 * ChatHeader — 聊天页顶部导航栏
 *
 * 内部使用 AppHeader 共享组件，仅保留 chat 页特有的菜单按钮逻辑。
 */
export default function ChatHeader({
  onBack,
  onMenu,
  showBack = true,
  showMenu = true,
}: Props) {
  return (
    <AppHeader
      title='一叶'
      onBack={onBack}
      showBack={showBack}
      leftActions={
        showMenu ? (
          <View
            className='chat-header__menu-btn'
            onClick={() => {
              onMenu?.()
            }}
          >
            <Icon name='AI--' size={46} color={IconColors.secondary} />
          </View>
        ) : undefined
      }
    />
  )
}
