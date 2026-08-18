import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import MarkdownBlock from '@/components/Chat/Blocks/MarkdownBlock'
import ThinkingBlock from '@/components/Chat/Blocks/ThinkingBlock'
import type { AnalysisStatus, ProgressStage, ChartConfig, TableConfig } from '@repo/types'
import './index.scss'

/** Minimum interval (ms) between auto-scroll triggers during streaming */
const SCROLL_THROTTLE_MS = 120

interface Props {
  status: AnalysisStatus | null
  thinkingText: string
  streamingText: string
  progressStage: ProgressStage | null
  progressPercent: number
  charts: ChartConfig[]
  tables: TableConfig[]
}

/** 阶段 → 中文文字 */
const STAGE_LABELS: Record<ProgressStage, string> = {
  upload: '正在上传文件...',
  parse: '正在解析文件结构...',
  profiling: '正在分析数据特征...',
  analyzing: '正在思考分析结论...',
  rendering: '正在生成分析报告...',
}

export default function AnalysisProgress({
  status,
  thinkingText,
  streamingText,
  progressStage,
  progressPercent,
  charts,
  tables,
}: Props) {
  const isPending = status === 'PENDING'
  const isAnalyzing = status === 'ANALYZING'
  const isFailed = status === 'FAILED'

  const stageLabel = progressStage
    ? STAGE_LABELS[progressStage]
    : '正在准备...'

  const hasThinking = thinkingText.length > 0
  const hasText = streamingText.length > 0
  // 思考仍在进行中：正在分析且正文尚未开始输出
  const thinkingActive = isAnalyzing && !hasText

  // ── Auto-scroll for streaming text ─────────────────────────
  const [followStreaming, setFollowStreaming] = useState(true)
  const [showScrollArrow, setShowScrollArrow] = useState(false)
  const contentLenRef = useRef(0)
  const lastFollowTickRef = useRef(0)
  const [followTick, setFollowTick] = useState(0)

  const blockId = useMemo(
    () => `ap-${Math.random().toString(36).slice(2, 8)}`,
    [],
  )
  const anchorA = `${blockId}-a`
  const anchorB = `${blockId}-b`

  useEffect(() => {
    if (isAnalyzing && followStreaming && hasText) {
      if (streamingText.length > contentLenRef.current) {
        contentLenRef.current = streamingText.length
        const now = Date.now()
        if (now - lastFollowTickRef.current > SCROLL_THROTTLE_MS) {
          lastFollowTickRef.current = now
          setFollowTick((t) => t + 1)
        }
      }
    }
  }, [streamingText, isAnalyzing, followStreaming, hasText])

  const handleDragStart = useCallback(() => {
    if (isAnalyzing && followStreaming) {
      setFollowStreaming(false)
      setShowScrollArrow(true)
    }
  }, [isAnalyzing, followStreaming])

  const handleArrowClick = useCallback(() => {
    setFollowStreaming(true)
    setShowScrollArrow(false)
    contentLenRef.current = streamingText.length
    lastFollowTickRef.current = 0
    setFollowTick((t) => t + 1)
  }, [streamingText.length])

  const scrollIntoView =
    followStreaming && isAnalyzing
      ? followTick % 2 === 0
        ? anchorA
        : anchorB
      : ''

  return (
    <View className='progress-step'>
      {/* 状态标题 */}
      <View className='progress-step__header'>
        <Text className='progress-step__title'>
          {isPending
            ? '等待执行...'
            : isAnalyzing
              ? '正在分析...'
              : isFailed
                ? '分析失败'
                : ''}
        </Text>
      </View>

      {/* ── Progress Bar ──────────────────────────────────── */}
      <View className='progress-step__bar-wrap'>
        <View className='progress-step__bar-track'>
          <View
            className='progress-step__bar-fill'
            style={{ width: `${Math.max(progressPercent, 2)}%` }}
          />
        </View>
        <Text className='progress-step__bar-label'>{stageLabel}</Text>
      </View>

      {/* 已生成的图表/表格计数 */}
      {(charts.length > 0 || tables.length > 0) && (
        <View className='progress-step__generated'>
          {charts.length > 0 && (
            <Text className='progress-step__gen-tag'>
              📊 {charts.length} 个图表已生成
            </Text>
          )}
          {tables.length > 0 && (
            <Text className='progress-step__gen-tag'>
              📋 {tables.length} 个表格已生成
            </Text>
          )}
        </View>
      )}

      {/* ── Thinking Area（复用 chat 的 ThinkingBlock 组件）─ */}
      {hasThinking && (
        <View className='progress-step__thinking'>
          <ThinkingBlock
            content={thinkingText}
            isStreaming={thinkingActive}
          />
        </View>
      )}

      {/* ── Streaming Text Area ───────────────────────────── */}
      {hasText && (
        <View className='progress-step__stream'>
          <ScrollView
            id={blockId}
            scrollY
            className='progress-step__stream-scroll'
            scrollIntoView={scrollIntoView}
            scrollWithAnimation={false}
            enhanced
            showScrollbar={false}
            onDragStart={handleDragStart}
          >
            <MarkdownBlock content={streamingText} />
            <View id={anchorA} style={{ height: 1 }} />
            <View id={anchorB} style={{ height: 1 }} />
          </ScrollView>

          {showScrollArrow && (
            <View
              className='progress-step__scroll-arrow'
              onClick={handleArrowClick}
            >
              <Text className='progress-step__scroll-arrow-icon'>▼</Text>
              <Text className='progress-step__scroll-arrow-label'>
                查看最新
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}
