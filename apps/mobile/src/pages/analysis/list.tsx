import { View, Text, ScrollView, Input } from '@tarojs/components'
import { AppHeader, Icon } from '@my/ui'
import { IconColors } from '@/styles/theme'
import Taro from '@tarojs/taro'
import { useState, useEffect, useCallback, useRef } from 'react'
import { analysisApi } from '@/services/analysis.api'
import { useUserStore } from '@/stores/user.store'
import type { AnalysisListItem } from '@repo/types'
import './list.scss'

/** 弹窗状态：rename = 重命名标题，delete = 确认删除 */
interface ModalState {
  type: 'rename' | 'delete'
  item: AnalysisListItem
}

/** 左滑露出操作按钮的总宽度（rpx，= 2 × 按钮宽 136rpx） */
const SWIPE_ACTIONS_WIDTH = 272
/** 判定为"滑动"的最小位移（px） */
const SWIPE_THRESHOLD = 30

export default function AnalysisListPage() {
  const [items, setItems] = useState<AnalysisListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [renameValue, setRenameValue] = useState('')
  /** 当前左滑展开的 item id（同一时间只展开一个） */
  const [openId, setOpenId] = useState<string | null>(null)
  const touchStartXRef = useRef(0)
  /** 本次触摸是否发生位移（抑制滑动后的误触点击） */
  const touchMovedRef = useRef(false)
  const authReady = useUserStore((state) => state.authReady)

  // ── 左滑手势 ───────────────────────────────────────────────

  const handleTouchStart = (e: any) => {
    touchStartXRef.current = e.touches[0].clientX
    touchMovedRef.current = false
  }

  const handleTouchEnd = (e: any, id: string) => {
    const dx = e.changedTouches[0].clientX - touchStartXRef.current
    if (dx < -SWIPE_THRESHOLD) {
      // 左滑 → 展开当前项（其他项自动收起）
      touchMovedRef.current = true
      setOpenId(id)
    } else if (dx > SWIPE_THRESHOLD) {
      // 右滑 → 收起
      touchMovedRef.current = true
      setOpenId(null)
    } else if (openId === id && Math.abs(dx) > 10) {
      // 展开状态下轻微滑动也收起，并抑制点击
      touchMovedRef.current = true
      setOpenId(null)
    }
  }

  const handleItemTap = (id: string) => {
    // 滑动结束时抑制误触：本次手势有位移则不跳转
    if (touchMovedRef.current) {
      touchMovedRef.current = false
      return
    }
    if (openId === id) {
      // 已展开：点击内容收起，不跳转
      setOpenId(null)
      return
    }
    setOpenId(null)
    handleItemClick(id)
  }

  const fetchList = useCallback(async (p: number) => {
    try {
      setLoading(true)
      const res = await analysisApi.listAnalyses(p)
      if (p === 1) {
        setItems(res.items)
      } else {
        setItems((prev) => [...prev, ...res.items])
      }
      setHasMore(res.hasMore)
    } catch {
      // keep current items
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authReady) {
      fetchList(1)
    }
  }, [authReady, fetchList])

  const handleLoadMore = () => {
    if (loading || !hasMore) return
    const nextPage = page + 1
    setPage(nextPage)
    // 加载更多时收起展开项
    setOpenId(null)
    fetchList(nextPage)
  }

  const handleItemClick = (id: string) => {
    Taro.navigateTo({ url: `/pages/analysis/detail?id=${id}` })
  }

  const handleBack = () => {
    Taro.navigateBack({ delta: 1 })
  }

  const handleSearch = () => {
    Taro.navigateTo({ url: '/pages/search/index?type=analysis' })
  }

  // ── 左滑：编辑（重命名）/ 删除 ─────────────────────────────

  const openRename = (item: AnalysisListItem) => {
    setRenameValue(item.title)
    setModal({ type: 'rename', item })
  }

  const openDelete = (item: AnalysisListItem) => {
    setModal({ type: 'delete', item })
  }

  const closeModal = () => setModal(null)

  const handleConfirmDelete = async () => {
    if (!modal || modal.type !== 'delete') return
    const item = modal.item
    setModal(null)
    setOpenId(null)
    try {
      await analysisApi.deleteAnalysis(item.id)
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (err: any) {
      Taro.showToast({ title: err.message || '删除失败', icon: 'none' })
    }
  }

  const handleConfirmRename = async () => {
    if (!modal || modal.type !== 'rename') return
    const title = renameValue.trim()
    if (!title) return
    const item = modal.item
    setModal(null)
    setOpenId(null)
    try {
      await analysisApi.renameAnalysis(item.id, title)
      // 更新本地标题（key 随 title 变化 → Swipe 重新挂载自动收起）
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, title } : i)),
      )
      Taro.showToast({ title: '已重命名', icon: 'success' })
    } catch (err: any) {
      Taro.showToast({ title: err.message || '重命名失败', icon: 'none' })
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case 'PENDING': return '等待中'
      case 'ANALYZING': return '分析中'
      case 'COMPLETED': return '已完成'
      case 'FAILED': return '失败'
      default: return status
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return '#117C0D'
      case 'ANALYZING': return '#FAC75E'
      case 'FAILED': return '#E74C3C'
      default: return '#9B9B9B'
    }
  }

  /** 服务端返回 ISO 时间串，格式化为本地 YYYY-MM-DD HH:mm */
  const formatTime = (iso: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  return (
    <View className='list-page'>
      <AppHeader
        title='我的分析'
        onBack={handleBack}
        leftActions={
          <View className='list-page__search-btn' onClick={handleSearch}>
            <Icon name='sousuo' size={40} color={IconColors.secondary} />
          </View>
        }
      />

      <ScrollView
        scrollY
        className='list-page__scroll'
        onScrollToLower={handleLoadMore}
        lowerThreshold={100}
      >
        {/* 内容容器：间距放在容器上（scroll-view 直接加 padding 会导致内容宽度不收缩、右侧溢出） */}
        <View className='list-page__content'>
        {items.length === 0 && !loading && (
          <View className='list-page__empty'>
            <Text className='list-page__empty-text'>暂无分析记录</Text>
          </View>
        )}

        {items.map((item) => {
          const isOpen = openId === item.id
          return (
            <View
              key={item.id}
              className={`list-page__item-wrap${isOpen ? ' is-open' : ''}`}
              onTouchStart={handleTouchStart}
              onTouchEnd={(e) => handleTouchEnd(e, item.id)}
            >
              {/* 操作层（绝对定位在内容下方，左滑时露出） */}
              <View className='list-page__item-actions'>
                <View
                  className='list-page__swipe-btn list-page__swipe-btn--edit'
                  onClick={() => openRename(item)}
                >
                  <Icon name='bianji' size={36} color='#1B1B1B' />
                  <Text>编辑</Text>
                </View>
                <View
                  className='list-page__swipe-btn list-page__swipe-btn--delete'
                  onClick={() => openDelete(item)}
                >
                  <Icon name='shanchu' size={36} color='#FFFFFF' />
                  <Text>删除</Text>
                </View>
              </View>
              {/* 内容层（左滑时平移露出操作按钮） */}
              <View
                className='list-page__item'
                style={
                  isOpen
                    ? { transform: `translateX(-${SWIPE_ACTIONS_WIDTH}rpx)` }
                    : undefined
                }
                onClick={() => handleItemTap(item.id)}
              >
                <View className='list-page__item-left'>
                  <Text className='list-page__item-title'>{item.title}</Text>
                  <View className='list-page__item-meta'>
                    {item.fileName && (
                      <Text className='list-page__item-file'>{item.fileName}</Text>
                    )}
                    {item.chartCount > 0 && (
                      <View className='list-page__item-charts'>
                        <Icon name='zhuzhuangtu' size={24} color={IconColors.secondary} />
                        <Text>{item.chartCount} 个图表</Text>
                      </View>
                    )}
                    <Text className='list-page__item-date'>{formatTime(item.createdAt)}</Text>
                  </View>
                </View>
                <View className='list-page__item-right'>
                  <Text
                    className='list-page__item-status'
                    style={{ color: statusColor(item.status) }}
                  >
                    {statusLabel(item.status)}
                  </Text>
                </View>
              </View>
            </View>
          )
        })}

        {loading && (
          <View className='list-page__loading'>
            <View className='list-page__loading-dots'>
              <View className='list-page__dot' />
              <View className='list-page__dot' />
              <View className='list-page__dot' />
            </View>
          </View>
        )}

        {!hasMore && items.length > 0 && (
          <View className='list-page__end'>
            <Text>— 没有更多了 —</Text>
          </View>
        )}
        </View>
      </ScrollView>

      {/* 编辑/删除确认弹窗 */}
      {modal && (
        <View className='list-page__modal-mask' onClick={closeModal}>
          <View
            className='list-page__modal'
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            {modal.type === 'delete' ? (
              <>
                <Text className='list-page__modal-title'>删除分析</Text>
                <Text className='list-page__modal-desc'>
                  确定删除「{modal.item.title}」吗？删除后不可恢复。
                </Text>
              </>
            ) : (
              <>
                <Text className='list-page__modal-title'>重命名分析</Text>
                <Input
                  className='list-page__modal-input'
                  value={renameValue}
                  onInput={(e) => setRenameValue(e.detail.value)}
                  placeholder='请输入新标题'
                  maxlength={50}
                />
              </>
            )}
            <View className='list-page__modal-actions'>
              <View className='list-page__modal-btn' onClick={closeModal}>
                <Text>取消</Text>
              </View>
              <View
                className={`list-page__modal-btn ${
                  modal.type === 'delete'
                    ? 'list-page__modal-btn--danger'
                    : 'list-page__modal-btn--primary'
                }`}
                onClick={
                  modal.type === 'delete'
                    ? handleConfirmDelete
                    : handleConfirmRename
                }
              >
                <Text>{modal.type === 'delete' ? '删除' : '确定'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
