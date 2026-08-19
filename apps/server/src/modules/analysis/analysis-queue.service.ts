import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import {
  ThinkTagParser,
  JsonlStreamParser,
  tryFixJson,
} from '@repo/analysis-parser';
import type { JsonlParsedEvent } from '@repo/analysis-parser';
import { ModelResolver, ResolvedModel } from '../chat/model-resolver.service';
import { ProviderFactory } from '../chat/providers/provider-factory.service';
import { AnalysisService } from './analysis.service';
import type {
  ChartConfig,
  TableConfig,
  ColumnProfile,
  AnalysisEvent,
} from '@repo/types';

/** 统计摘要需要的最小行数 */
const MIN_ROWS_FOR_STATS = 10;

/** 图表最大数量 */
const MAX_CHARTS = 5;

@Injectable()
export class AnalysisQueueService {
  private readonly logger = new Logger(AnalysisQueueService.name);

  constructor(
    private readonly analysisService: AnalysisService,
    private readonly modelResolver: ModelResolver,
    private readonly providerFactory: ProviderFactory,
  ) {}

  /**
   * 执行分析任务，返回 AsyncGenerator<AnalysisEvent>。
   *
   * 调用方（Controller）遍历 events 并通过 SSE 推送给客户端。
   */
  async *execute(
    userId: number,
    sessionId: string,
    prompt: string,
    model: string,
  ): AsyncGenerator<AnalysisEvent> {
    // ── 1. 状态 → ANALYZING ──────────────────────────────────
    await this.analysisService.updateStatus(sessionId, 'ANALYZING');

    try {
      // ── 2. 读取文件 ────────────────────────────────────────
      yield { type: 'progress', stage: 'upload', percent: 5 };

      await this.analysisService.getSession(userId, sessionId);
      const fileRecord =
        await this.analysisService.getFileByAnalysisId(sessionId);

      if (!fileRecord) {
        throw new Error('文件记录不存在，请重新上传文件');
      }

      const filePath = fileRecord.fileUrl;
      if (!fs.existsSync(filePath)) {
        throw new Error('文件已过期，请重新上传');
      }

      // ── 3. Excel Parser (SheetJS) ───────────────────────────
      yield { type: 'progress', stage: 'parse', percent: 10 };

      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const rowCount = rows.length;
      const columnCount = columns.length;

      // ── 4. Data Profiler ────────────────────────────────────
      yield { type: 'progress', stage: 'profiling', percent: 20 };

      const sampleSize = Math.min(rowCount, 5);
      const sample = rows.slice(0, sampleSize);

      // 列级别分析
      const columnProfiles = this.profileColumns(columns, sample, rows);
      // 数值列统计（基于全量数据）
      const statistics =
        rowCount >= MIN_ROWS_FOR_STATS
          ? this.computeStatistics(columns, rows)
          : undefined;

      // ── 5. 构建 LLM Prompt ──────────────────────────────────
      yield { type: 'progress', stage: 'analyzing', percent: 30 };

      const { systemPrompt, userPrompt: dataPrompt } = this.buildPrompts({
        fileName: fileRecord.fileName,
        rowCount,
        columnCount,
        columnProfiles,
        statistics,
        sampleRows: sample,
        userPrompt: prompt,
      });

      // ── 6. 调用 AI Provider ─────────────────────────────────
      yield { type: 'progress', stage: 'analyzing', percent: 40 };

      const resolved: ResolvedModel = await this.modelResolver.resolve(
        userId,
        model,
      );
      const provider = this.providerFactory.getProvider(resolved.protocolType);

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: dataPrompt },
      ];

      // ── 7. 流式接收 + Think 解析 + 事件分类推送 ──────────────
      let fullText = ''; // 原始 JSONL 文本（不含 thinking，仅日志/fallback 用）
      const charts: ChartConfig[] = [];
      const tables: TableConfig[] = [];
      const thinkParser = new ThinkTagParser();
      const state = {
        summaryText: '',
        insightsList: [] as string[],
        cleanContent: '',
        charts,
        tables,
        parsedAny: false,
      };
      const streamParser = new JsonlStreamParser({
        onDebug: (msg) => this.logger.debug(msg),
      });

      yield { type: 'progress', stage: 'analyzing', percent: 50 };

      for await (const chunk of provider.streamChat(
        messages,
        resolved.config,
      )) {
        // 诊断日志：记录每个 chunk 的类型和内容长度
        this.logger.log(
          `[stream] chunk.type="${chunk.type}" contentLen=${chunk.content.length} preview="${chunk.content.slice(0, 80)}"`,
        );

        // ── 处理 thinking ──
        if (chunk.type === 'thinking') {
          this.logger.log(
            `[stream] → yielding thinking event, deltaLen=${chunk.content.length}`,
          );
          yield { type: 'thinking', delta: chunk.content };
          continue;
        }

        // ── 检测并处理 content 中的 <think> 标签 ──
        const thinkResults = thinkParser.feed(chunk.content);
        for (const tr of thinkResults) {
          if (tr.type === 'thinking') {
            this.logger.log(
              `[stream] ThinkTagParser → thinking, len=${tr.content.length} preview="${tr.content.slice(0, 80)}"`,
            );
            yield { type: 'thinking', delta: tr.content };
          } else {
            // answer 部分 → 流式 JSONL 解析 → 分类推送（summary/insights/report/chart）
            fullText += tr.content;
            yield* this.dispatchParsedEvents(
              streamParser.feed(tr.content),
              state,
            );
          }
        }
      }

      // Flush <think> parser 残余
      const thinkRemaining = thinkParser.flush();
      for (const tr of thinkRemaining) {
        if (tr.type === 'thinking') {
          yield { type: 'thinking', delta: tr.content };
        } else {
          fullText += tr.content;
          yield* this.dispatchParsedEvents(
            streamParser.feed(tr.content),
            state,
          );
        }
      }

      // Flush JSONL parser 残余
      yield* this.dispatchParsedEvents(streamParser.flush(), state);

      // ── 完整原始输出日志（仅正文，不含 thinking）──
      this.logger.log(
        `\n===== AI RAW OUTPUT (content only, no thinking) =====\n${fullText}\n===== END AI RAW OUTPUT =====`,
      );

      // ── Fallback：一个事件都没解析出（AI 完全未遵循 JSONL）→ 降级为纯文本 ──
      // 只要解析出了任意事件（哪怕只有 chart/table），就绝不把原始 JSONL 倾倒给用户。
      if (!state.parsedAny && fullText.trim().length > 0) {
        this.logger.warn(
          '[fallback] 未解析出任何事件，AI 未遵循 JSONL 格式，降级为纯文本模式',
        );
        state.cleanContent = fullText.trim();

        // 尝试从原始文本中抢救 chart/table JSON 片段
        const rescuedCharts = this.rescueChartFragments(fullText);
        const rescuedTables = this.rescueTableFragments(fullText);
        for (const c of rescuedCharts) {
          if (charts.length < MAX_CHARTS) charts.push(c);
        }
        for (const t of rescuedTables) {
          if (tables.length < MAX_CHARTS) tables.push(t);
        }
        this.logger.log(
          `[fallback] rescued charts=${rescuedCharts.length} tables=${rescuedTables.length}`,
        );
      }

      // ── 8. 组装 summary / insights / 正文 ───────────────────
      yield { type: 'progress', stage: 'rendering', percent: 85 };

      let summary = state.summaryText.trim();
      const insights = state.insightsList;
      const cleanContent = state.cleanContent;

      // 补充回退：AI 漏掉 summary/insights 事件时，从正文（如含"分析摘要/关键发现"章节）提取
      if (!summary || insights.length === 0) {
        const { summary: s, insights: i } =
          this.extractSummaryAndInsights(cleanContent);
        if (!summary) summary = s || (insights.length > 0 ? insights[0] : '');
        insights.push(...i.filter((x) => !insights.includes(x)));
      }

      const finalSummary = summary || '分析完成';

      // ── 解析结果摘要日志 ──
      this.logger.log(
        `[parse-summary] eventsParsed=${state.parsedAny ? 'yes' : 'no'} ` +
          `fallback=${cleanContent.length > 0 && !state.parsedAny ? 'yes' : 'no'} ` +
          `summaryLen=${finalSummary.length} insights=${insights.length} ` +
          `textLen=${cleanContent.length} charts=${charts.length} tables=${tables.length}`,
      );

      // ── 9. 持久化结果（不含 thinking） ──────────────────────
      await this.analysisService.saveCharts(sessionId, charts);
      await this.analysisService.saveResult(sessionId, {
        summary: finalSummary,
        content: cleanContent,
        insights,
      });

      // ── 10. 状态 → COMPLETED ────────────────────────────────
      await this.analysisService.updateStatus(sessionId, 'COMPLETED');

      yield {
        type: 'complete',
        payload: {
          summary: finalSummary,
          content: cleanContent,
          charts,
          tables,
          insights,
        },
      };
    } catch (err: any) {
      this.logger.error(`Analysis failed for session ${sessionId}:`, err);
      await this.analysisService.updateStatus(sessionId, 'FAILED');
      yield {
        type: 'error',
        message: err.message || '分析失败，请重试',
      };
    }
  }

  // ── Event Dispatch（流式解析结果的分类推送）────────────────

  /**
   * 将解析出的 JSONL 事件按四事件协议分类：
   * - summary → SSE summary 事件
   * - insights → SSE insights 事件
   * - report / text（旧协议兼容）→ SSE report 事件 + 正文累积
   * - chart / table → 累积（chart 同时推送 SSE chart 事件）
   */
  private *dispatchParsedEvents(
    events: JsonlParsedEvent[],
    state: {
      summaryText: string;
      insightsList: string[];
      cleanContent: string;
      charts: ChartConfig[];
      tables: TableConfig[];
      parsedAny: boolean;
    },
  ): Generator<AnalysisEvent, void, undefined> {
    for (const event of events) {
      state.parsedAny = true;
      switch (event.type) {
        case 'summary':
          state.summaryText += event.content;
          yield { type: 'summary', delta: event.content };
          break;
        case 'insights':
          state.insightsList.push(...event.items);
          yield { type: 'insights', items: event.items };
          break;
        case 'report':
        case 'text': // 兼容旧协议：text 归入报告正文
          state.cleanContent += event.content;
          yield { type: 'report', delta: event.content };
          break;
        case 'chart':
          if (state.charts.length < MAX_CHARTS) {
            state.charts.push(event.payload);
          }
          yield { type: 'chart', chart: event.payload };
          break;
        case 'table':
          if (state.tables.length < MAX_CHARTS) {
            state.tables.push(event.payload);
          }
          break;
      }
    }
  }

  // ── Data Profiler ─────────────────────────────────────────

  /** 逐列分析：类型、可空性等 */
  private profileColumns(
    columns: string[],
    sample: Record<string, any>[],
    allRows: Record<string, any>[],
  ): ColumnProfile[] {
    return columns.map((col) => {
      const allValues = allRows.map((r) => r[col]);
      const nonNull = allValues.filter((v) => v != null);
      const uniqueValues = new Set(nonNull.map(String));
      const inferredType = this.inferColumnType(nonNull);

      return {
        name: col,
        type: inferredType,
        nullable: nonNull.length < allValues.length,
        uniqueCount: uniqueValues.size,
      };
    });
  }

  /** 推断单列类型 */
  private inferColumnType(values: any[]): ColumnProfile['type'] {
    if (values.length === 0) return 'unknown';
    const allNumbers = values.every((v) => !isNaN(Number(v)));
    if (allNumbers) return 'number';
    const datePattern = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
    const allDates = values.every(
      (v) => datePattern.test(String(v)) && !isNaN(Date.parse(String(v))),
    );
    if (allDates) return 'date';
    return 'string';
  }

  /** 计算数值列基本统计量（基于全量数据） */
  private computeStatistics(
    columns: string[],
    rows: Record<string, any>[],
  ): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const col of columns) {
      const values = rows.map((r) => Number(r[col])).filter((v) => !isNaN(v));
      if (values.length < 2) continue;

      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const mean = sum / sorted.length;
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const variance =
        sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;

      stats[col] = {
        count: values.length,
        min: this.round(min),
        max: this.round(max),
        mean: this.round(mean),
        median: this.round(median),
        stdDev: this.round(Math.sqrt(variance)),
        nullCount: rows.length - values.length,
      };
    }
    return stats;
  }

  private round(n: number, decimals = 2): number {
    return Math.round(n * 10 ** decimals) / 10 ** decimals;
  }

  // ── Prompt Builders ───────────────────────────────────────

  /** 构建 System Prompt + User Prompt */
  private buildPrompts(params: {
    fileName: string;
    rowCount: number;
    columnCount: number;
    columnProfiles: ColumnProfile[];
    statistics?: Record<string, any>;
    sampleRows: Record<string, any>[];
    userPrompt: string;
  }): { systemPrompt: string; userPrompt: string } {
    const {
      fileName,
      rowCount,
      columnCount,
      columnProfiles,
      statistics,
      sampleRows,
      userPrompt: rawUserPrompt,
    } = params;

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt({
      fileName,
      rowCount,
      columnCount,
      columnProfiles,
      statistics,
      sampleRows,
      userPrompt: rawUserPrompt,
    });

    return { systemPrompt, userPrompt };
  }

  /** System Prompt：角色 + 任务目标 + 四事件 JSONL 协议 */
  private buildSystemPrompt(): string {
    return `你是数据分析专家。你的任务不是简单复述数据，而是：
1. 发现数据中的关键趋势、异常和规律
2. 主动识别适合可视化的维度，生成 chart 事件
3. 用 report 事件输出 Markdown 分析报告（每个 report 事件只写一个章节）

## 输出协议（JSONL）

每行一个 JSON 对象，用 **"event"** 字段区分类型。禁止输出任何非 JSON 文本。
每行必须是一个完整、独立的 JSON 对象，一个事件输出完毕后换行再输出下一个事件。
必须严格按照以下顺序输出事件：

### 第 1 个事件：summary（分析摘要）
{"event":"summary","delta":"用 1-2 句话、非技术语言概括数据整体情况与核心结论，不罗列细节、不出现指标清单"}

### 第 2 个事件：insights（关键发现）
{"event":"insights","items":["发现1","发现2","发现3","发现4","发现5"]}
- 3-5 条结论性发现，每条一句话，按重要性降序排列，只写结论不写图表说明

### 第 3 个及之后：report（分析报告正文）
{"event":"report","delta":"## 章节标题\\n\\n正文内容..."}
- 每个 report 事件只写一个章节，章节标题用 "## " 或 "### "
- 换行必须转义为 \\n，禁止把整份报告塞进一个 report 事件

### chart（分析图表，最多 ${MAX_CHARTS} 个）
{"event":"chart","chart":{"id":"c1","type":"bar","title":"各产品销售额","data":[{"产品":"A","销售额":12000},{"产品":"B","销售额":8500}]}}
- type: bar（类别对比）/ line（时间趋势）/ pie（占比分布）
- data 第一个字段为维度，其余为数值系列（pie 用 name/value）
- **只要数据包含数值列，就必须输出至少 1 个 chart 事件，不得省略**

## 禁止
- 在 JSON 行外添加任何文字
- 将 JSON 包裹在 \`\`\` 代码块中
- JSON 字符串内使用真实换行（必须 \\n 转义）
- 用 report 事件代替 chart 事件（图表必须用 chart 事件输出）`;
  }

  /** User Prompt：数据摘要 + 用户需求 */
  private buildUserPrompt(params: {
    fileName: string;
    rowCount: number;
    columnCount: number;
    columnProfiles: ColumnProfile[];
    statistics?: Record<string, any>;
    sampleRows: Record<string, any>[];
    userPrompt: string;
  }): string {
    const {
      fileName,
      rowCount,
      columnCount,
      columnProfiles,
      statistics,
      sampleRows,
      userPrompt,
    } = params;

    const colSummary = columnProfiles
      .map(
        (c) =>
          `  - ${c.name} (${c.type}${c.nullable ? ', 可空' : ''}, ${c.uniqueCount} 个唯一值)`,
      )
      .join('\n');

    let statsSection = '';
    if (statistics) {
      statsSection =
        '\n- 数值列统计摘要:\n```json\n' +
        JSON.stringify(statistics, null, 2) +
        '\n```';
    }

    // 用户需求提到图表时，注入硬性要求（双保险）
    const wantsChart =
      /图表|柱状图|饼图|折线图|条形图|曲线图|趋势图|可视化|图形/.test(
        userPrompt,
      );
    const chartRequirement = wantsChart
      ? '\n【硬性要求】用户需求中明确要求输出图表，你必须输出至少 1 个 chart 事件，图表数据必须基于数据摘要中的真实统计值。'
      : '';

    return `【数据摘要】
- 文件名: ${fileName}
- 总行数: ${rowCount}
- 列数: ${columnCount}
- 列信息:
${colSummary}${statsSection}
- 样本数据（前 ${sampleRows.length} 行）:
\`\`\`json
${JSON.stringify(sampleRows, null, 2)}
\`\`\`

【用户需求】
${userPrompt}${chartRequirement}

请严格按 System Prompt 的 JSONL 协议从第一行开始逐行输出，每行一个完整的 JSON 事件，不要输出 JSON 以外的任何内容。`;
  }

  // ── Summary & Insights Extraction ─────────────────────────

  /**
   * 从分析文本中提取"分析摘要"与"关键发现"。
   *
   * AI 遵循报告结构时（system prompt 强制）：
   * - 摘要 = "分析摘要" 标题后的第一段
   * - 发现 = "关键发现" 标题后的全部列表项（- / * / 数字编号）
   * 回退：匹配不到摘要标题时取正文第一段。
   */
  private extractSummaryAndInsights(text: string): {
    summary: string;
    insights: string[];
  } {
    let summary = '';
    const insights: string[] = [];

    // 按标题切分章节：## 分析摘要 / **关键发现** 等（支持 # 标题与 **加粗** 两种形式）
    const sections = text.split(/\n(?=#{1,6}\s+|\*\*[^*]+\*\*\s*[：:]?\s*\n)/);

    for (const section of sections) {
      const heading = section.split('\n')[0];

      if (/分析摘要|摘要/.test(heading) && !summary) {
        const body = section.split('\n').slice(1).join('\n').trim();
        const firstPara = body
          .split(/\n\n/)[0]
          ?.replace(/\s*\n\s*/g, ' ')
          .trim();
        if (firstPara) summary = firstPara;
      } else if (/关键发现|主要发现/.test(heading)) {
        const body = section.split('\n').slice(1).join('\n');
        for (const line of body.split('\n')) {
          const item = line
            .replace(/^\s*[-*•]\s*/, '')
            .replace(/^\s*\d+[.、)]\s*/, '')
            .replace(/\*\*/g, '')
            .replace(/`/g, '')
            .trim();
          if (item) insights.push(item);
        }
      }
    }

    // 回退：未匹配到摘要标题 → 取正文第一段
    if (!summary) {
      const firstParagraph = text.split('\n\n')[0];
      if (firstParagraph) {
        summary = firstParagraph.replace(/^#+\s*/, '').trim();
      }
    }

    return { summary, insights };
  }

  // ── Fragment Rescue（Fallback 用）───────────────────────────

  /**
   * 从非 JSONL 的原始文本中尝试提取 chart JSON 片段。
   * 匹配模式：{"event":"chart",...} 或 {"chart":{...}}
   */
  private rescueChartFragments(raw: string): ChartConfig[] {
    const charts: ChartConfig[] = [];
    // 匹配 {"event":"chart","chart":{...}}
    const re =
      /\{"event"\s*:\s*"chart"\s*,\s*"chart"\s*:\s*(\{(?:[^{}]|(?:\{[^{}]*\}))*\})\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      try {
        const inner = m[1];
        const obj = JSON.parse(inner);
        if (obj?.type && obj?.title && obj?.data) {
          charts.push(obj as ChartConfig);
        }
      } catch {
        // 尝试用 tryFixJson 修复后再解析
        const fixed = tryFixJson(m[0]);
        if (fixed) {
          try {
            const repaired = JSON.parse(fixed);
            const c = repaired?.chart;
            if (c?.type && c?.title && c?.data) {
              charts.push(c as ChartConfig);
            }
          } catch {
            // 修复后仍无法解析，跳过
          }
        }
      }
    }
    return charts;
  }

  /** 从非 JSONL 的原始文本中尝试提取 table JSON 片段 */
  private rescueTableFragments(raw: string): TableConfig[] {
    const tables: TableConfig[] = [];
    const re =
      /\{"event"\s*:\s*"table"\s*,\s*"table"\s*:\s*(\{(?:[^{}]|(?:\{[^{}]*\}))*\})\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      try {
        const inner = m[1];
        const obj = JSON.parse(inner);
        if (obj?.title && obj?.columns && obj?.data) {
          tables.push(obj as TableConfig);
        }
      } catch {
        const fixed = tryFixJson(m[0]);
        if (fixed) {
          try {
            const repaired = JSON.parse(fixed);
            const t = repaired?.table;
            if (t?.title && t?.columns && t?.data) {
              tables.push(t as TableConfig);
            }
          } catch {
            // skip
          }
        }
      }
    }
    return tables;
  }
}
