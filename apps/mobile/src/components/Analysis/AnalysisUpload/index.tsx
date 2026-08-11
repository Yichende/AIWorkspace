import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { analysisApi } from '@/services/analysis.api'
import type { DatasetSummary } from '@repo/types'
import './index.scss'

interface Props {
  onUploaded: (
    file: { name: string; size: number },
    fileId: string,
    dataset: DatasetSummary,
  ) => void
}

const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTS = ['.xlsx', '.xls', '.csv']

export default function AnalysisUpload({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleChooseFile = async () => {
    setError('')

    try {
      const res = await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
      })

      const file = res.tempFiles[0]
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()

      // 格式校验
      if (!ALLOWED_EXTS.includes(ext)) {
        setError('仅支持 .xlsx .xls .csv 格式')
        return
      }

      // 大小校验
      if (file.size > MAX_SIZE) {
        setError('文件大小不能超过 10MB')
        return
      }

      // 上传
      setUploading(true)
      try {
        const result = await analysisApi.upload(file.path, file.name)
        onUploaded(
          { name: file.name, size: file.size },
          result.fileId,
          result.dataset,
        )
      } catch (err: any) {
        setError(err.message || '上传失败，请重试')
      } finally {
        setUploading(false)
      }
    } catch (err: any) {
      if (err.errMsg?.includes('cancel')) return
      setError(err.errMsg || '选择文件失败')
    }
  }

  return (
    <View className='upload-step'>
      <View className='upload-step__header'>
        <Text className='upload-step__title'>上传数据文件</Text>
        <Text className='upload-step__subtitle'>
          支持 Excel (.xlsx/.xls) 和 CSV (.csv) 格式，最大 10MB
        </Text>
      </View>

      <View className='upload-step__zone' onClick={handleChooseFile}>
        {uploading ? (
          <View className='upload-step__loading'>
            <View className='upload-step__spinner' />
            <Text className='upload-step__loading-text'>正在上传并解析...</Text>
          </View>
        ) : (
          <>
            <Text className='upload-step__icon'>📁</Text>
            <Text className='upload-step__cta'>点击选择文件</Text>
            <Text className='upload-step__hint'>从聊天记录中选择 Excel 或 CSV 文件</Text>
          </>
        )}
      </View>

      {error && (
        <View className='upload-step__error'>
          <Text user-select>{error}</Text>
        </View>
      )}
    </View>
  )
}
