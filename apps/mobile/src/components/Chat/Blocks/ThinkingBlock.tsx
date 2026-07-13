import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

import './ThinkingBlock.scss'

/** Minimum interval (ms) between auto-scroll triggers during streaming */
const SCROLL_THROTTLE_MS = 120
/** Brief window (ms) after arrow-click where drag events are suppressed */
const ARROW_GUARD_MS = 200

interface Props {
  content: string
  isStreaming?: boolean
}

export default function ThinkingBlock({ content, isStreaming }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [showScrollArrow, setShowScrollArrow] = useState(false)
  const [followStreaming, setFollowStreaming] = useState(true)
  const [followTick, setFollowTick] = useState(0)
  const lastFollowTickRef = useRef(0)
  const arrowGuardRef = useRef(false)
  const arrowGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const blockId = useMemo(
    () => `ts-${Math.random().toString(36).slice(2, 8)}`,
    [],
  )
  const anchorA = `${blockId}-a`
  const anchorB = `${blockId}-b`

  useEffect(() => {
    return () => {
      if (arrowGuardTimerRef.current) clearTimeout(arrowGuardTimerRef.current)
    }
  }, [])

  // ── Auto-follow during streaming ──
  const contentLenRef = useRef(content.length)
  useEffect(() => {
    if (isStreaming && followStreaming) {
      if (content.length > contentLenRef.current) {
        contentLenRef.current = content.length
        const now = Date.now()
        if (now - lastFollowTickRef.current > SCROLL_THROTTLE_MS) {
          lastFollowTickRef.current = now
          setFollowTick((t) => t + 1)
        }
      }
    }
  }, [content, isStreaming, followStreaming])

  useEffect(() => {
    if (isStreaming) {
      contentLenRef.current = content.length
      lastFollowTickRef.current = 0
      setFollowStreaming(true)
      setShowScrollArrow(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming])

  // ── User drag: pause auto-follow ──
  const handleDragStart = useCallback(() => {
    if (arrowGuardRef.current) return
    if (isStreaming && followStreaming) {
      setFollowStreaming(false)
      setShowScrollArrow(true)
    }
  }, [isStreaming, followStreaming])

  // ── Arrow click: resume following ──
  const handleArrowClick = useCallback(() => {
    if (arrowGuardTimerRef.current) clearTimeout(arrowGuardTimerRef.current)
    arrowGuardRef.current = true
    arrowGuardTimerRef.current = setTimeout(() => {
      arrowGuardRef.current = false
    }, ARROW_GUARD_MS)

    setFollowStreaming(true)
    setShowScrollArrow(false)
    contentLenRef.current = content.length
    lastFollowTickRef.current = 0
    setFollowTick((t) => t + 1)
  }, [content.length])

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const scrollIntoView =
    followStreaming && isStreaming
      ? followTick % 2 === 0
        ? anchorA
        : anchorB
      : ''

  return (
    <View
      className={`thinking-block ${isStreaming ? 'thinking-streaming' : ''}`}
    >
      <View className='thinking-header' onClick={handleToggleCollapse}>
        <View className='thinking-header-left'>
          <View className={`thinking-dot ${isStreaming ? 'pulsing' : ''}`} />
          <Text className='thinking-label'>
            {isStreaming ? '深度思考中...' : '已完成深度思考'}
          </Text>
        </View>
        <Text className={`thinking-arrow ${!collapsed ? 'open' : ''}`}>▼</Text>
      </View>

      <View className={`thinking-content-wrap ${collapsed ? 'collapsed' : ''}`}>
        <ScrollView
          id={blockId}
          scrollY
          className='thinking-content-scroll'
          scrollIntoView={scrollIntoView}
          scrollWithAnimation={false}
          enhanced
          showScrollbar={false}
          onDragStart={handleDragStart}
        >
          <Text className='thinking-text'>{content}</Text>
          <View id={anchorA} style={{ height: 1 }} />
          <View id={anchorB} style={{ height: 1 }} />
        </ScrollView>
      </View>

      {showScrollArrow && (
        <View className='thinking-scroll-arrow' onClick={handleArrowClick}>
          <Text className='thinking-scroll-arrow-icon'>▼</Text>
          <Text className='thinking-scroll-arrow-label'>查看最新</Text>
        </View>
      )}
    </View>
  )
}
