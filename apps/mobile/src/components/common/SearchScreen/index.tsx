import { View, Text, Input, ScrollView } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import type { ReactNode } from 'react'
import './index.scss'

interface SearchScreenProps<T> {
  /** 输入框占位文案 */
  placeholder: string
  /** 未输入关键词时的提示文案 */
  hintText: string
  /** 搜索请求（分页），keyword 为空时不会调用 */
  search: (
    keyword: string,
    page: number,
  ) => Promise<{ items: T[]; hasMore: boolean }>
  /** 结果条目内容渲染 */
  renderItem: (item: T) => ReactNode
  /** 条目点击 */
  onItemClick?: (item: T) => void
  /** 条目 key 提取（默认用数组下标） */
  itemKey?: (item: T) => string
  onBack: () => void
}

const DEBOUNCE_MS = 300

/**
 * SearchScreen — 通用搜索屏幕（搜索栏 + 结果列表 + 分页 + 空态/提示态）
 *
 * 数据源与条目 UI 由调用方注入，用于复用"搜索对话历史 / 搜索分析结果"
 * 两种模式（见 pages/search/index.tsx）。
 */
function SearchScreen<T>({
  placeholder,
  hintText,
  search,
  renderItem,
  onItemClick,
  itemKey,
  onBack,
}: SearchScreenProps<T>) {
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<T[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  /** 请求序号：用于丢弃过期响应（快速输入时防止旧结果覆盖新结果） */
  const seqRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清理防抖定时器
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const runSearch = useCallback(
    async (kw: string, p: number) => {
      if (!kw.trim()) {
        setItems([])
        setSearched(false)
        return
      }
      const seq = ++seqRef.current
      setLoading(true)
      try {
        const res = await search(kw.trim(), p)
        if (seq !== seqRef.current) return // 过期响应，丢弃
        setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]))
        setHasMore(res.hasMore)
        setSearched(true)
      } catch {
        if (seq === seqRef.current) {
          setItems([])
          setHasMore(false)
          setSearched(true)
        }
      } finally {
        if (seq === seqRef.current) setLoading(false)
      }
    },
    [search],
  )

  const handleInput = (e: { detail: { value: string } }) => {
    const kw = e.detail.value
    setKeyword(kw)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      runSearch(kw, 1)
    }, DEBOUNCE_MS)
  }

  const handleLoadMore = () => {
    if (loading || !hasMore || !searched || !keyword.trim()) return
    const nextPage = page + 1
    setPage(nextPage)
    runSearch(keyword, nextPage)
  }

  const renderBody = () => {
    // 未输入关键词 → 提示态
    if (!keyword.trim() || !searched) {
      return (
        <View className='search-state'>
          <Icon name='sousuo' size={64} color={IconColors.secondary} />
          <Text className='search-state-text'>{hintText}</Text>
        </View>
      )
    }

    // 有搜索词但无结果 → 空态
    if (items.length === 0) {
      return (
        <View className='search-state'>
          <Icon name='duihuaxiaoxi' size={64} color={IconColors.secondary} />
          <Text className='search-state-text'>暂无搜索结果</Text>
        </View>
      )
    }

    return (
      <>
        {items.map((item, idx) => (
          <View
            key={itemKey ? itemKey(item) : idx}
            className='search-item'
            onClick={() => onItemClick?.(item)}
          >
            {renderItem(item)}
          </View>
        ))}

        {loading && (
          <View className='search-loading'>
            <View className='search-loading-dots'>
              <View className='search-dot' />
              <View className='search-dot' />
              <View className='search-dot' />
            </View>
          </View>
        )}

        {!hasMore && items.length > 0 && (
          <View className='search-end'>
            <Text>— 没有更多了 —</Text>
          </View>
        )}
      </>
    )
  }

  return (
    <View className='search-screen'>
      {/* 搜索栏 */}
      <View className='search-bar'>
        <View className='search-back' onClick={onBack}>
          <Icon name='fanhui' size={44} color={IconColors.accent} />
        </View>

        <View className='search-input-wrapper'>
          <Icon name='sousuo' size={34} color={IconColors.secondary} />
          <Input
            className='search-input'
            value={keyword}
            placeholder={placeholder}
            placeholderClass='search-placeholder'
            focus
            onInput={handleInput}
          />
        </View>
      </View>

      {/* 搜索结果（分页滚动） */}
      <ScrollView
        scrollY
        className='search-result'
        onScrollToLower={handleLoadMore}
        lowerThreshold={100}
      >
        <View className='search-list'>{renderBody()}</View>
      </ScrollView>
    </View>
  )
}

export default SearchScreen
