import { View, Text, Image } from '@tarojs/components'
import { IconColors } from '@/styles/theme'
import { AppHeader, Icon } from '@my/ui'

import Taro from '@tarojs/taro'
import './index.scss'

export default function HomePage() {

  const go2User = () => {
    Taro.navigateTo({
      url: '/pages/user/index',
    })
  }

  const gotoChat = () => {
    Taro.navigateTo({
      url: '/pages/chat/index',
    })
  }

  const gotoAnalysis = () => {
    Taro.navigateTo({
      url: '/pages/analysis/index',
    })
  }

  const gotoMyAnalyses = () => {
    Taro.navigateTo({
      url: '/pages/analysis/list',
    })
  }

  const go2Test = () => {
    Taro.navigateTo({
      url: '/pages/myTest/index',
    })
  }

  return (
    <View className='home-page'>
      <AppHeader
        title='一叶'
        showBack={false}
        leftActions={
          <View className='home-page__user-btn' onClick={go2User}>
            <Icon name='wode' size={46} color={IconColors.secondary} />
          </View>
        }
      />

      {/* 装饰图区域 */}
      <View className='decorate-area'>
        <Image
          className='decorate-image'
          src='' // 替换为实际装饰图
          mode='aspectFill'
        />
      </View>

      {/* 功能区 - 左右两张卡片 */}
      <View className='feature-section'>
        {/* 智能对话卡片 */}
        <View className='feature-card' onClick={gotoChat}>
          <View className='card-row'>
            <Icon
              className='card-icon'
              name='xiaoxi'
              size={52}
              color={IconColors.secondary}
            />
            <View className='card-text'>
              <Text className='card-title'>智能对话</Text>
              <Text className='card-subtitle'>多模型自由问答</Text>
            </View>
          </View>
        </View>

        {/* 表格分析卡片 */}
        <View className='feature-card' onClick={gotoAnalysis}>
          <View className='card-row'>
            <Icon
              className='card-icon'
              name='shujufenxi'
              size={52}
              color={IconColors.secondary}
            />
            <View className='card-text'>
              <Text className='card-title'>表格分析</Text>
              <Text className='card-subtitle'>导入表格，自动生成图表</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 报告入口（同样左侧图标+右侧文字） */}
      <View className='report-entry' onClick={gotoMyAnalyses}>
        <View className='card-row'>
          <Icon name='baobiaochaxun' size={52} color={IconColors.secondary} />
          <View className='card-text'>
            <Text className='card-title'>我的分析报告</Text>
            <Text className='card-subtitle'>查看与整理历史分析</Text>
          </View>
        </View>
        <Icon name='qianjin' size={28} color={IconColors.secondary} />
      </View>
      <button className='home-page__test-btn' onClick={go2Test}>Test Page</button>
    </View>
  )
}
