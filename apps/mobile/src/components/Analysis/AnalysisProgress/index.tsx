import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { AnalysisStatus, ChartConfig, TableConfig } from '@repo/types'
import { useSettingsStore } from '@/stores/settings.store'
import MarkdownBlock from '@/components/Chat/Blocks/MarkdownBlock'
import ThinkingBlock from '@/components/Chat/Blocks/ThinkingBlock'
import AnalysisSummary from '../AnalysisSummary'
import AnalysisInsights from '../AnalysisInsights'
import AnalysisCharts from '../AnalysisCharts'
import AnalysisTables from '../AnalysisTables'
import './index.scss'

/** Minimum interval (ms) between auto-scroll triggers during streaming */
const SCROLL_THROTTLE_MS = 120

interface Props {
  status: AnalysisStatus | null
  thinkingText: string
  streamingText: string
  streamingSummary: string
  streamingInsights: string[]
  /** 是否已解析出任一事件（false 说明服务端最终会纯文本兜底） */
  parsedAny: boolean
  progressPercent: number
  charts: ChartConfig[]
  tables: TableConfig[]
  /** 是否由用户主动停止（决定失败文案） */
  stopped?: boolean
  /** 失败原因（stop 时为空） */
  errorMessage?: string
  /** 传输层超时：连接已断开，但分析仍在后台进行（**不是失败**） */
  streamTimeout?: boolean
  /** 提供后超时提示区显示「重新连接」 */
  onReconnect?: () => void
  /** 提供后显示停止按钮 */
  onStop?: () => void
  /** 提供后失败区显示「重试」 */
  onRetry?: () => void
  /** 提供后失败区显示「重新上传」 */
  onReupload?: () => void
}

export default function AnalysisProgress({
  status,
  thinkingText,
  streamingText,
  streamingSummary,
  streamingInsights,
  parsedAny,
  progressPercent,
  charts,
  tables,
  stopped = false,
  errorMessage = '',
  streamTimeout = false,
  onStop,
  onRetry,
  onReupload,
  onReconnect,
}: Props) {
  const isPending = status === 'PENDING'
  const isAnalyzing = status === 'ANALYZING'
  const isFailed = status === 'FAILED'
  // 全局"显示思考过程"偏好（关闭后隐藏思考区）
  const showThinking = useSettingsStore((s) => s.showThinking)

  const hasThinking = thinkingText.length > 0
  const hasSummary = streamingSummary.length > 0
  const hasInsights = streamingInsights.length > 0
  const hasCharts = charts.length > 0
  const hasTables = tables.length > 0
  const hasText = streamingText.length > 0
  // 思考仍在进行中：正在分析、正文尚未开始输出且未隐藏思考区
  const thinkingActive = isAnalyzing && !hasText && showThinking
  const hasStreamContent =
    hasSummary || hasInsights || hasCharts || hasTables || hasText

  const failedTitle = stopped ? '已停止分析' : '分析失败'
  const canStop = (isPending || isAnalyzing) && !!onStop

  // ── 事件驱动状态文案（按已收到的事件推进：思考→摘要→发现→图表→表格→报告）─
  const eventStage = isFailed
    ? failedTitle
    : isPending
      ? '等待执行...'
      : parsedAny
        ? hasText
          ? '正在撰写分析报告'
          : hasTables
            ? '正在生成表格'
            : hasCharts
              ? '正在生成图表'
              : hasInsights
                ? '正在整理关键发现'
                : hasSummary
                  ? '正在分析摘要'
                  : '正在分析数据'
        : thinkingActive
          ? '正在思考分析数据'
          : '正在生成分析结果...'

  // ── Auto-scroll for streaming content ─────────────────────
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

  // 内容指纹：各事件类型内容长度之和，驱动流式滚动
  const contentLen =
    streamingText.length +
    streamingSummary.length +
    streamingInsights.length +
    charts.length +
    tables.length

  useEffect(() => {
    if (isAnalyzing && followStreaming && hasStreamContent) {
      if (contentLen > contentLenRef.current) {
        contentLenRef.current = contentLen
        const now = Date.now()
        if (now - lastFollowTickRef.current > SCROLL_THROTTLE_MS) {
          lastFollowTickRef.current = now
          setFollowTick((t) => t + 1)
        }
      }
    }
  }, [contentLen, isAnalyzing, followStreaming, hasStreamContent])

  const handleDragStart = useCallback(() => {
    if (isAnalyzing && followStreaming) {
      setFollowStreaming(false)
      setShowScrollArrow(true)
    }
  }, [isAnalyzing, followStreaming])

  const handleArrowClick = useCallback(() => {
    setFollowStreaming(true)
    setShowScrollArrow(false)
    contentLenRef.current = contentLen
    lastFollowTickRef.current = 0
    setFollowTick((t) => t + 1)
  }, [contentLen])

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
                ? failedTitle
                : ''}
        </Text>
        {canStop && (
          <View className='progress-step__stop' onClick={onStop}>
            <View className='progress-step__stop-icon' />
          </View>
        )}
      </View>

      {/* ── 失败/停止：原因 + 出口 ───────────────────────────── */}
      {isFailed && (
        <View className='progress-step__failure'>
          <Text className='progress-step__failure-text'>
            {stopped ? '已停止分析' : errorMessage || '分析失败'}
          </Text>
          <View className='progress-step__failure-actions'>
            {onRetry && (
              <View className='progress-step__btn' onClick={onRetry}>
                <Text className='progress-step__btn-text'>重试</Text>
              </View>
            )}
            {onReupload && (
              <View
                className='progress-step__btn progress-step__btn--ghost'
                onClick={onReupload}
              >
                <Text className='progress-step__btn-text'>重新上传</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── 传输层超时：分析没失败，只是这条连接被服务端收尾了 ────
          复用失败区的样式（同一类「需要用户动作」的提示块），
          但文案与出口都不同 —— 不报错，只给「重新连接」。 */}
      {streamTimeout && !isFailed && !stopped && (
        <View className='progress-step__failure'>
          <Text className='progress-step__failure-text'>
            连接已断开，分析仍在后台进行
          </Text>
          {onReconnect && (
            <View className='progress-step__failure-actions'>
              <View className='progress-step__btn' onClick={onReconnect}>
                <Text className='progress-step__btn-text'>重新连接</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── Progress Bar（下方为事件驱动状态文案）────────────── */}
      <View className='progress-step__bar-wrap'>
        <View className='progress-step__bar-track'>
          <View
            className='progress-step__bar-fill'
            style={{ width: `${Math.max(progressPercent, 2)}%` }}
          />
        </View>
        {isAnalyzing && (
          <Text className='progress-step__bar-label'>{eventStage}</Text>
        )}
      </View>

      {/* ── Thinking Area（复用 chat 的 ThinkingBlock 组件）─ */}
      {hasThinking && showThinking && (
        <View className='progress-step__thinking'>
          <ThinkingBlock
            content={thinkingText}
            isStreaming={thinkingActive}
          />
        </View>
      )}

      {/* ── Streaming Content Area（每解析完一个事件立即增量显示）─ */}
      {hasStreamContent && (
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
            <AnalysisSummary summary={streamingSummary} />
            <AnalysisInsights insights={streamingInsights} />
            <AnalysisCharts charts={charts} />
            <AnalysisTables tables={tables} />
            {hasText && <MarkdownBlock content={streamingText} />}
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
