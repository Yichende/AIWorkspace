import { create } from 'zustand';
import type {
  AnalysisStep,
  AnalysisStatus,
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
  /** 进度消息列表 */
  progress: string[];
  /** 流式累积文本 */
  streamingText: string;

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

  /** 追加一条进度消息 */
  addProgress: (msg: string) => void;

  /** 追加流式文本 */
  appendText: (delta: string) => void;

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
  progress: [],
  streamingText: '',
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

    addProgress: (msg) =>
      set((state) => ({
        progress: [...state.progress, msg],
      })),

    appendText: (delta) =>
      set((state) => ({
        streamingText: state.streamingText + delta,
      })),

    addChart: (chart) =>
      set((state) => ({
        charts: [...state.charts, chart],
      })),

    addTable: (table) =>
      set((state) => ({
        tables: [...state.tables, table],
      })),

    setComplete: (result) =>
      set({
        status: 'COMPLETED',
        result,
        step: 'result',
      }),

    setFailed: (error) =>
      set({
        status: 'FAILED',
        progress: (state) => [...state.progress, `❌ ${error}`],
      }),

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
