import { View, Text, Input } from '@tarojs/components'
import { useState } from 'react'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import Taro from '@tarojs/taro'

import './index.scss'

export default function SearchPage() {
  const [keyword, setKeyword] = useState('')

  const handleBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  return (
    <View className='search-page'>
      {/* 搜索栏 */}
      <View className='search-bar'>
        <View className='search-back' onClick={handleBack}>
          <Icon name='fanhui' size={44} color={IconColors.accent} />
        </View>

        <View className='search-input-wrapper'>
          <Icon name='sousuo' size={34} color={IconColors.secondary} />
          <Input
            className='search-input'
            value={keyword}
            placeholder='搜索对话历史...'
            placeholderClass='search-placeholder'
            focus
            onInput={(e) => setKeyword(e.detail.value)}
          />
        </View>
      </View>

      {/* 搜索结果 */}
      <View className='search-result'>
        {keyword ? (
          <View className='search-empty'>
            <Icon name='duihuaxiaoxi' size={64} color={IconColors.secondary} />
            <Text className='search-empty-text'>暂无搜索结果</Text>
          </View>
        ) : (
          <View className='search-hint'>
            <Text className='search-hint-text'>输入关键词搜索对话历史</Text>
          </View>
        )}
      </View>
    </View>
  )
}
