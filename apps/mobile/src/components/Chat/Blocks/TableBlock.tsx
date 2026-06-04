import { View } from '@tarojs/components'

export default function TableBlock({ block }: any) {
  return <View className='table-block'>{block.content}</View>
}
