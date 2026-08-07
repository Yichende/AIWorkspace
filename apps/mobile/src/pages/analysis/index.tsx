import { View } from '@tarojs/components'
import { AppHeader } from '@my/ui'
import Taro from '@tarojs/taro'
import AnalysisContainer from '@/components/Analysis/AnalysisContainer'
import './index.scss'

export default function AnalysisPage() {
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
        rightAction={
          <View className='analysis-page__my-btn' onClick={handleMyAnalyses}>
            📊
          </View>
        }
      />
      <AnalysisContainer />
    </View>
  )
}
