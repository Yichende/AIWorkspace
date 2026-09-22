import { useCallback } from 'react'
import Taro from '@tarojs/taro'
import { useAnalysisStore } from '@/stores/analysis.store'
import { analysisApi } from '@/services/analysis.api'
import type { AnalysisStreamCallbacks } from '@/services/analysis.api'
import type {
  ProgressStage,
  AnalysisResult as AnalysisResultType,
  AnalysisStatus,
} from '@repo/types'

// ── Active stream tracking ───────────────────────────────────
//
// 与 chat.controller 的 activeStream 同构：放模块级而非组件内 ref，
// 使退出登录等跨页面场景也能中断进行中的分析 SSE。

interface ActiveAnalysisStream {
  task?: Taro.RequestTask<any>
  /** 用户主动停止标记 —— 与真实错误区分（决定「已停止」还是「分析失败」文案） */
  stopRequested: boolean
  /**
   * 静默脱离标记（离开页面）。
   *
   * 与 stopRequested 严格区分：脱离只是「不要了」，**不改任何 UI 状态**，
   * 服务端运行照旧继续；停止是用户意图，要落「已停止」并调服务端 cancel。
   */
  detached: boolean
}

let activeAnalysisStream: ActiveAnalysisStream | null = null

/** 静默脱离：中止本地连接，但不写 store、不碰服务端 */
function detachStream(ctl: ActiveAnalysisStream | null): void {
  if (!ctl) return
  ctl.detached = true
  ctl.task?.abort()
}

/**
 * 中断当前分析流（停止按钮与退出登录共用）。
 *
 * 注意断开语义已在「真队列化」重构后改变：客户端 abort **不再**中止上游，
 * 断开只是「少了一个听众」，运行会在 worker 里继续跑到 COMPLETED。
 * 真正要终止分析必须调 `POST /analysis/:id/cancel`（见 stopAnalysis）。
 */
export function stopActiveAnalysisStream(): void {
  if (!activeAnalysisStream) return
  activeAnalysisStream.stopRequested = true
  activeAnalysisStream.task?.abort()
  activeAnalysisStream = null
}

/**
 * 静默脱离当前分析流（离开页面时用）。
 *
 * 不置 stopRequested、不改 store —— 用户只是离开了，分析还在后台跑，
 * 回头再进来应当能附着回同一条运行。
 */
export function detachActiveAnalysisStream(): void {
  if (!activeAnalysisStream) return
  detachStream(activeAnalysisStream)
  activeAnalysisStream = null
}

/**
 * useAnalysisStream — SSE 事件分发 Hook
 *
 * 职责：
 * - 创建分析任务 (POST /analysis/create) 并订阅 SSE 流
 * - 附着到**已经在跑**的会话 (attachToSession)，带游标只收增量
 * - 服务端按规范化事件推送（summary / insights / report / chart / table），
 *   此处分发到 analysisStore
 * - 支持停止与重试
 *
 * 事件顺序门控：模型输出顺序不稳定，summary 未到达时 insights/chart/table
 * 先入 pending 队列不显示；收到 summary 后逐个释放（summary → insights →
 * chart → table 按序出现）。report 正文不设门控，保持流式体验。
 *
 * Container 只需调用 startAnalysis()，读取 store 渲染 UI。
 */
export function useAnalysisStream() {
  const {
    setSessionId,
    setStatus,
    appendThinking,
    appendStreamingText,
    setStreamingSummary,
    setStreamingInsights,
    addChart,
    addTable,
    setProgress,
    setComplete,
    setFailed,
    setStopped,
    setPrompt,
    resetStreamingState,
    clearStreamBuffers,
    markPrefixTruncated,
    setStreamTimeout,
    setLastSeq,
    hydrate,
  } = useAnalysisStore()

  /**
   * 订阅某个会话的 SSE 流。
   *
   * @param after 游标。附着到已在跑的会话时必须带（store 里的 lastSeq），
   *   否则服务端会从头重放，append 语义会把已产出的正文再追加一遍。
   */
  const runStream = useCallback(
    async (
      sessionId: string,
      ctl: ActiveAnalysisStream,
      after = 0,
    ): Promise<void> => {
      // 每个回调都要先挡一道：abort 是异步的，脱离页面时可能已有回调排在队列里，
      // 不挡就会让「已经离开的页面」继续往 store 里写（一个事件两处更新）。
      const gone = () => ctl.detached

      let summaryShown = false
      const pending: Array<() => void> = []
      const flushPending = () => {
        while (pending.length > 0) {
          pending.shift()!()
        }
      }

      const callbacks: AnalysisStreamCallbacks = {
        onThinking: (delta: string) => {
          if (gone()) return
          appendThinking(delta)
        },

        onSummary: (delta: string) => {
          if (gone()) return
          summaryShown = true
          setStreamingSummary(delta)
          // summary 到达后逐个释放排队事件（insights → chart → table）
          flushPending()
        },

        onInsights: (items: string[]) => {
          if (gone()) return
          if (summaryShown) setStreamingInsights(items)
          else pending.push(() => setStreamingInsights(items))
        },

        onReport: (delta: string) => {
          if (gone()) return
          // 正文不设门控，保持流式
          appendStreamingText(delta)
        },

        onChart: (chart) => {
          if (gone()) return
          if (summaryShown) addChart(chart)
          else pending.push(() => addChart(chart))
        },

        onTable: (table) => {
          if (gone()) return
          if (summaryShown) addTable(table)
          else pending.push(() => addTable(table))
        },

        onProgress: (stage: string, percent: number) => {
          if (gone()) return
          setProgress(stage as ProgressStage, percent)
        },

        onSeq: (seq: number) => {
          if (gone()) return
          setLastSeq(seq)
        },

        onTruncated: () => {
          if (gone()) return
          // 服务端缓冲越界：残缺缓冲与随后的帧拼起来会错位，整个丢掉。
          // 之后的 replay 仍然是「服务端现存的全量」，所以不需要重连，
          // 只要把「前缀已丢失」如实标出来，别把残缺内容当完整报告展示。
          clearStreamBuffers()
          markPrefixTruncated()
        },

        onTimeout: () => {
          if (gone()) return
          // 传输层超时 ≠ 失败：分析还在后台跑，保留 status 与 stopped，
          // 只挂提示并让 UI 给出「重新连接」入口。
          setStreamTimeout(true)
        },

        onComplete: (result: AnalysisResultType) => {
          if (gone()) return
          // summary 从未出现时也不阻塞到底，统一释放排队事件
          flushPending()
          setComplete(result)
        },

        onError: (err: string) => {
          if (gone()) return
          if (ctl.stopRequested) setStopped()
          else setFailed(err)
        },

        // 服务端正常收尾：终态帧（complete / error）此前已经发过了，
        // 这里什么都不用做 —— 它存在的意义是让「连接关闭」不再是唯一信号。
        onDone: () => {},

        onTaskReady: (task) => {
          ctl.task = task
          // 用户在 task 建立前就点了停止/离开了页面（stream 里有 await 取 token）
          if (ctl.stopRequested || ctl.detached) task.abort()
        },
      }

      await analysisApi.stream(sessionId, callbacks, after)

      if (gone()) return

      // 流 promise 只在请求结束时 settle。正常结束时 store 已是 COMPLETED/FAILED；
      // 仍停在中间态说明是静默断连（fail 回调没有给出错误），必须给出出口。
      const snapshot = useAnalysisStore.getState()
      if (snapshot.status === 'COMPLETED' || snapshot.status === 'FAILED') return
      if (ctl.stopRequested) {
        setStopped()
        return
      }
      // 超时已经挂过提示：分析还在后台跑，不能再覆盖成「分析失败」
      if (snapshot.streamTimeout) return
      setFailed('连接中断，请重试')
    },
    [
      appendThinking,
      setStreamingSummary,
      setStreamingInsights,
      appendStreamingText,
      addChart,
      addTable,
      setProgress,
      setComplete,
      setFailed,
      setStopped,
      clearStreamBuffers,
      markPrefixTruncated,
      setStreamTimeout,
      setLastSeq,
    ],
  )

  const startAnalysis = useCallback(
    async (fileId: string, userPrompt: string, model: string) => {
      setPrompt(userPrompt)
      setStatus('PENDING')

      detachStream(activeAnalysisStream)
      const ctl: ActiveAnalysisStream = {
        stopRequested: false,
        detached: false,
      }
      activeAnalysisStream = ctl

      try {
        // 1. 创建分析任务
        const { id } = await analysisApi.create({
          fileId,
          prompt: userPrompt,
          model,
        })
        if (ctl.stopRequested || ctl.detached) return

        setSessionId(id)
        setStatus('ANALYZING' as AnalysisStatus)

        // 2. 订阅 SSE 流（新会话从 seq 0 开始，不需要游标）
        await runStream(id, ctl)
      } catch (err: any) {
        if (ctl.detached) return
        if (ctl.stopRequested) setStopped()
        else setFailed(err.message || '创建任务失败')
      } finally {
        if (activeAnalysisStream === ctl) activeAnalysisStream = null
      }
    },
    [runStream, setPrompt, setStatus, setSessionId, setFailed, setStopped],
  )

  /**
   * 附着到一个已经在跑的会话（详情页打开历史记录时用）。
   *
   * 与 startAnalysis 的区别：不 create，直接读会话状态 ——
   * 已完成就 hydrate 落结果，失败就落错误文案，非终态才挂直播流。
   *
   * @param reset 是否先清空流式缓冲。首次进入页面应为 true（store 里可能
   *   还留着上一个会话的残留）；超时后「重新连接」应为 false，这样
   *   lastSeq 得以保留，服务端只回放增量。
   */
  const attachToSession = useCallback(
    async (
      sessionId: string,
      opts: { reset?: boolean } = {},
    ): Promise<void> => {
      if (opts.reset ?? true) resetStreamingState()
      // 重新连接时清掉上一轮的「连接已断开」提示（前缀丢失标记不在此清除：
      // 那是既成事实，重连也补不回被驱逐的内容）
      setStreamTimeout(false)

      // 同一槽位只留一条流：覆盖前先把旧的静默脱离
      detachStream(activeAnalysisStream)
      const ctl: ActiveAnalysisStream = {
        stopRequested: false,
        detached: false,
      }
      activeAnalysisStream = ctl

      try {
        const detail = await analysisApi.getDetail(sessionId)
        if (ctl.detached) return

        setSessionId(sessionId)

        // 已经跑完：直接落结果，不必再挂流
        if (detail.result) {
          hydrate({
            sessionId,
            charts: detail.charts ?? [],
            tables: detail.tables ?? [],
            result: detail.result,
          })
          return
        }

        // 已经失败：把服务端持久化的原因显示出来（此前刷新后只剩一句「分析失败」）
        if (detail.session.status === 'FAILED') {
          setFailed(detail.errorMessage || '分析失败')
          return
        }

        // 运行中：先用 REST 拿到的进度把进度条摆正。
        // 否则附着时只能从 0 开始，一直等到下一个 progress 帧。
        if (detail.progress) {
          setProgress(detail.progress.stage, detail.progress.percent)
        }
        setStatus(
          (detail.session.status === 'PENDING'
            ? 'PENDING'
            : 'ANALYZING') as AnalysisStatus,
        )

        // 带上游标，只收增量（append 语义下重放会重复正文）
        await runStream(sessionId, ctl, useAnalysisStore.getState().lastSeq)
      } catch (err: any) {
        if (ctl.detached) return
        setFailed(err.message || '加载分析失败')
      } finally {
        if (activeAnalysisStream === ctl) activeAnalysisStream = null
      }
    },
    [
      runStream,
      resetStreamingState,
      setStreamTimeout,
      setSessionId,
      setStatus,
      setProgress,
      setFailed,
      hydrate,
    ],
  )

  /** 停止当前分析（立即置 UI 状态，abort 可能不产生任何回调） */
  const stopAnalysis = useCallback((): void => {
    const { sessionId } = useAnalysisStore.getState()

    setStopped()
    stopActiveAnalysisStream()

    // 只 abort 本地连接是不够的：重构后断开只代表「少了一个听众」，
    // 运行会在 worker 里继续跑到 COMPLETED。必须显式取消。
    if (sessionId) {
      analysisApi.cancel(sessionId).catch(() => {
        // 取消失败不改变本地「已停止」的语义，也不值得弹错打扰用户
      })
    }
  }, [setStopped])

  /** 离开页面：静默脱离，不改变任何状态，服务端运行照旧 */
  const detachToSession = useCallback((): void => {
    detachStream(activeAnalysisStream)
    activeAnalysisStream = null
  }, [])

  /**
   * 重试：旧会话保持 FAILED，用同一份 fileId/prompt/model 创建一个**新**会话重新分析。
   *
   * 不复用旧会话重跑：服务端只对非终态会话执行管道，FAILED 会话重连只会重放 error。
   */
  const retryAnalysis = useCallback(async (): Promise<void> => {
    const { fileId, prompt, model } = useAnalysisStore.getState()
    if (!fileId || !prompt) return

    resetStreamingState()
    await startAnalysis(fileId, prompt, model)
  }, [resetStreamingState, startAnalysis])

  return {
    startAnalysis,
    attachToSession,
    detachToSession,
    stopAnalysis,
    retryAnalysis,
  }
}
