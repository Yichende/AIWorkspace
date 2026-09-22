import { create } from 'zustand';
import type {
  AnalysisStep,
  AnalysisStatus,
  ProgressStage,
  DatasetSummary,
  ChartConfig,
  TableConfig,
  AnalysisResult,
} from '@repo/types';
import { DEFAULT_MODEL } from '@repo/constants';
import { useSettingsStore } from './settings.store';

// ── State ─────────────────────────────────────────────────────

interface AnalysisState {
  /** 当前页面步骤 */
  step: AnalysisStep;
  /** 分析会话 ID（create 后获得） */
  sessionId: string | null;

  // ── 上传阶段 ──
  file: { name: string; size: number } | null;
  fileId: string | null;
  dataset: DatasetSummary | null;

  // ── Prompt 阶段 ──
  prompt: string;
  model: string;

  // ── 分析阶段 ──
  status: AnalysisStatus | null;
  /** 思考文本（仅内存，不持久化） */
  thinkingText: string;
  /** 流式正文（report 事件，append 语义） */
  streamingText: string;
  /** 流式摘要（summary 事件，set 语义，complete 后由 result 覆盖） */
  streamingSummary: string;
  /** 流式关键发现（insights 事件，set 语义，complete 后由 result 覆盖） */
  streamingInsights: string[];
  /** 流式图表（chart 事件，add 语义） */
  charts: ChartConfig[];
  /** 流式表格（table 事件，add 语义） */
  tables: TableConfig[];
  /** 是否已解析出任一事件（false 时服务端兜底为纯文本） */
  parsedAny: boolean;
  /** 进度阶段 */
  progressStage: ProgressStage | null;
  /** 进度百分比 */
  progressPercent: number;
  /** 是否由用户主动停止（区分「停止」与「失败」的文案） */
  stopped: boolean;
  /** 失败原因（stop 时为空）；独立于 thinkingText，思考面板关闭时也要能显示 */
  errorMessage: string;
  /**
   * 已收到的最新事件序号（SSE `id:` 行），重连时作为 `?after=` 游标回传。
   * 放在 store 而不是 hook 局部变量：跨页面、跨次附着都要读它。
   */
  lastSeq: number;
  /**
   * 传输层超时（服务端主动收尾连接）。**不是失败** —— 分析仍在后台跑，
   * 所以不动 status、不置 stopped，UI 给的是「重新连接」入口。
   */
  streamTimeout: boolean;
  /**
   * 服务端缓冲已越界，正文**前缀永久丢失**。UI 必须如实说明，
   * 不能把残缺内容当成一份完整报告展示。
   */
  prefixTruncated: boolean;

  // ── 结果阶段 ──
  result: AnalysisResult | null;
}

// ── Actions ───────────────────────────────────────────────────

interface AnalysisActions {
  /** 切换步骤 */
  setStep: (step: AnalysisStep) => void;

  /** 上传完成：保存文件信息和数据集摘要 */
  setFile: (
    file: { name: string; size: number },
    fileId: string,
    dataset: DatasetSummary,
  ) => void;

  /** 设置分析 prompt */
  setPrompt: (prompt: string) => void;

  /** 设置模型 */
  setModel: (model: string) => void;

  /** 设置会话 ID（create 后获得） */
  setSessionId: (id: string) => void;

  /** 设置分析状态 */
  setStatus: (status: AnalysisStatus) => void;

  /** 追加思考文本 */
  appendThinking: (delta: string) => void;

  /** 追加流式正文（report 事件） */
  appendStreamingText: (delta: string) => void;

  /** 设置流式摘要（summary 事件，set 语义） */
  setStreamingSummary: (delta: string) => void;

  /** 设置流式关键发现（insights 事件，set 语义） */
  setStreamingInsights: (items: string[]) => void;

  /** 设置进度 */
  setProgress: (stage: ProgressStage, percent: number) => void;

  /** 添加一个图表 */
  addChart: (chart: ChartConfig) => void;

  /** 添加一个表格 */
  addTable: (table: TableConfig) => void;

  /** 分析完成 */
  setComplete: (result: AnalysisResult) => void;

  /** 分析失败 */
  setFailed: (error: string) => void;

  /** 用户主动停止分析 */
  setStopped: () => void;

  /** 记录最新事件序号（游标） */
  setLastSeq: (seq: number) => void;

  /** 设置/清除「连接超时」提示（只改提示，不动 status / stopped） */
  setStreamTimeout: (value: boolean) => void;

  /** 标记正文前缀因服务端缓冲越界而丢失 */
  markPrefixTruncated: () => void;

  /** 清空流式缓存（重试/重新分析前调用；不改 status 与 step） */
  resetStreamingState: () => void;

  /**
   * 只清流式缓冲与游标，**不动 status / step**。
   * 用于服务端游标越界后重新对齐 —— 那条路径上分析还在跑，
   * 状态必须保持 ANALYZING（resetStreamingState 会把 status 一并清掉）。
   */
  clearStreamBuffers: () => void;

  /** 加载已保存的分析详情 */
  hydrate: (data: {
    sessionId: string;
    charts: ChartConfig[];
    tables: TableConfig[];
    result: AnalysisResult;
  }) => void;

  /** 重置所有状态 */
  reset: () => void;
}

// ── Initial State ─────────────────────────────────────────────

const initialState: AnalysisState = {
  step: 'upload',
  sessionId: null,
  file: null,
  fileId: null,
  dataset: null,
  prompt: '',
  // 默认模型：用户设置优先，不存在/非法时回退系统默认
  model: useSettingsStore.getState().defaultModel || DEFAULT_MODEL,
  status: null,
  thinkingText: '',
  streamingText: '',
  streamingSummary: '',
  streamingInsights: [],
  charts: [],
  tables: [],
  parsedAny: false,
  progressStage: null,
  progressPercent: 0,
  stopped: false,
  errorMessage: '',
  lastSeq: 0,
  streamTimeout: false,
  prefixTruncated: false,
  result: null,
};

// ── Store ─────────────────────────────────────────────────────

export const useAnalysisStore = create<AnalysisState & AnalysisActions>(
  (set) => ({
    ...initialState,

    setStep: (step) => set({ step }),

    setFile: (file, fileId, dataset) =>
      set({
        file,
        fileId,
        dataset,
        step: 'preview',
      }),

    setPrompt: (prompt) => set({ prompt }),

    setModel: (model) => set({ model }),

    setSessionId: (sessionId) => set({ sessionId }),

    setStatus: (status) => set({ status }),

    appendThinking: (delta) =>
      set((state) => ({
        thinkingText: state.thinkingText + delta,
      })),

    appendStreamingText: (delta) =>
      set((state) => ({
        streamingText: state.streamingText + delta,
        parsedAny: true,
      })),

    setStreamingSummary: (delta) =>
      set({
        streamingSummary: delta,
        parsedAny: true,
      }),

    setStreamingInsights: (items) =>
      set({
        streamingInsights: items,
        parsedAny: true,
      }),

    setProgress: (stage, percent) =>
      set({ progressStage: stage, progressPercent: percent }),

    addChart: (chart) =>
      set((state) => ({
        charts: [...state.charts, chart],
        parsedAny: true,
      })),

    addTable: (table) =>
      set((state) => ({
        tables: [...state.tables, table],
        parsedAny: true,
      })),

    setComplete: (result) =>
      set((state) => {
        // 合并服务端 complete payload 中的图表/表格（按 id 去重），
        // 保证客户端流式解析遗漏时结果页仍能渲染服务端恢复的图表。
        const mergeById = <T extends { id?: string }>(
          list: T[],
          incoming: T[],
        ) => {
          const ids = new Set(list.map((x) => x.id));
          return [...list, ...incoming.filter((x) => x.id && !ids.has(x.id))];
        };
        return {
          status: 'COMPLETED',
          result,
          progressPercent: 100,
          step: 'result',
          thinkingText: '',       // 分析完成后清除思考内容（不保存）
          streamingText: '',      // 正文已存入 result.content，清空流式缓存
          streamingSummary: '',   // 摘要已存入 result.summary
          streamingInsights: [],  // 发现已存入 result.insights
          stopped: false,
          errorMessage: '',
          charts: mergeById(state.charts, result.charts ?? []),
          tables: mergeById(state.tables, result.tables ?? []),
        };
      }),

    setFailed: (error) =>
      set((state) => ({
        status: 'FAILED',
        stopped: false,
        errorMessage: error,
        thinkingText:
          state.thinkingText + `\n❌ ${error}`,
      })),

    setStopped: () =>
      set({
        status: 'FAILED',
        stopped: true,
        errorMessage: '',
      }),

    setLastSeq: (seq) => set({ lastSeq: seq }),

    // 超时只是「这条连接没了」，分析还在后台跑：不动 status / stopped
    setStreamTimeout: (value) => set({ streamTimeout: value }),

    markPrefixTruncated: () => set({ prefixTruncated: true }),

    resetStreamingState: () =>
      set({
        status: null,
        thinkingText: '',
        streamingText: '',
        streamingSummary: '',
        streamingInsights: [],
        charts: [],
        tables: [],
        parsedAny: false,
        progressStage: null,
        progressPercent: 0,
        stopped: false,
        errorMessage: '',
        lastSeq: 0,
        streamTimeout: false,
        prefixTruncated: false,
        result: null,
      }),

    clearStreamBuffers: () =>
      set({
        thinkingText: '',
        streamingText: '',
        streamingSummary: '',
        streamingInsights: [],
        charts: [],
        tables: [],
        parsedAny: false,
        lastSeq: 0,
      }),

    hydrate: (data) =>
      set({
        sessionId: data.sessionId,
        step: 'result',
        status: 'COMPLETED',
        charts: data.charts,
        tables: data.tables,
        result: data.result,
        streamTimeout: false,
        prefixTruncated: false,
      }),

    // 每次重置时重取用户设置的默认模型（AnalysisPage 每次进入都调 reset）
    reset: () =>
      set({
        ...initialState,
        model: useSettingsStore.getState().defaultModel || DEFAULT_MODEL,
      }),
  }),
);
