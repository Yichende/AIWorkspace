import { Button } from '@nutui/nutui-react-taro'
import { View } from '@tarojs/components'
// import '@nutui/nutui-react-taro/dist/style.css'
import './index.scss'

export default function Test() {
  const marginStyle = { margin: '8px' }
  return (
    <View className='page'>
      <Button type='primary' style={marginStyle}>
        Share
      </Button>
      <Button type='info' style={marginStyle}>
        打开授权设置页
      </Button>
    </View>
  )
}
