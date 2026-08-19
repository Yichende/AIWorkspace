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
  /** 流式累积正文（report 事件） */
  streamingText: string;
  /** 流式累积摘要（summary 事件，complete 后由 result 覆盖） */
  streamingSummary: string;
  /** 流式累积关键发现（insights 事件，complete 后由 result 覆盖） */
  streamingInsights: string[];
  /** 进度阶段 */
  progressStage: ProgressStage | null;
  /** 进度百分比 */
  progressPercent: number;

  // ── 结果阶段 ──
  charts: ChartConfig[];
  tables: TableConfig[];
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
  appendReport: (delta: string) => void;

  /** 追加流式摘要（summary 事件） */
  appendSummary: (delta: string) => void;

  /** 追加关键发现（insights 事件） */
  addInsights: (items: string[]) => void;

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
  model: 'DeepSeek-R1',
  status: null,
  thinkingText: '',
  streamingText: '',
  streamingSummary: '',
  streamingInsights: [],
  progressStage: null,
  progressPercent: 0,
  charts: [],
  tables: [],
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

    appendReport: (delta) =>
      set((state) => ({
        streamingText: state.streamingText + delta,
      })),

    appendSummary: (delta) =>
      set((state) => ({
        streamingSummary: state.streamingSummary + delta,
      })),

    addInsights: (items) =>
      set((state) => ({
        streamingInsights: [...state.streamingInsights, ...items],
      })),

    setProgress: (stage, percent) =>
      set({ progressStage: stage, progressPercent: percent }),

    addChart: (chart) =>
      set((state) => ({
        charts: [...state.charts, chart],
      })),

    addTable: (table) =>
      set((state) => ({
        tables: [...state.tables, table],
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
          charts: mergeById(state.charts, result.charts ?? []),
          tables: mergeById(state.tables, result.tables ?? []),
        };
      }),

    setFailed: (error) =>
      set((state) => ({
        status: 'FAILED',
        thinkingText:
          state.thinkingText + `\n❌ ${error}`,
      })),

    hydrate: (data) =>
      set({
        sessionId: data.sessionId,
        step: 'result',
        status: 'COMPLETED',
        charts: data.charts,
        tables: data.tables,
        result: data.result,
      }),

    reset: () => set(initialState),
  }),
);
