import { View } from '@tarojs/components'
import { AppHeader, Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import Taro from '@tarojs/taro'
import { useEffect } from 'react'
import AnalysisContainer from '@/components/Analysis/AnalysisContainer'
import { useAnalysisStore } from '@/stores/analysis.store'
import './index.scss'

export default function AnalysisPage() {
  // 每次新进入分析页时重置分析流程（返回首页再进入应显示上传页）。
  // 分析页 → 列表 → 返回不会重新挂载本页，因此进行中的状态不受影响。
  useEffect(() => {
    useAnalysisStore.getState().reset()
  }, [])

  const handleBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  const handleMyAnalyses = () => {
    Taro.navigateTo({ url: '/pages/analysis/list' })
  }

  return (
    <View className='analysis-page'>
      <AppHeader
        title='数据分析'
        onBack={handleBack}
        leftActions={
          <View className='analysis-page__my-btn' onClick={handleMyAnalyses}>
            <Icon name='he_18gongzuotai' size={44} color={IconColors.secondary} />
          </View>
        }
      />
      <AnalysisContainer />
    </View>
  )
}
