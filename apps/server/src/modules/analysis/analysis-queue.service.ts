import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
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

/** 表格最大数量（与图表分开控制，避免混用同一上限） */
const MAX_TABLES = 5;

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

      // 注意：不传 jsonMode（response_format: json_object 会强制单一 JSON 对象，
      // 与 JSONL 多事件序列冲突；且 deepseek-reasoner 类模型不支持该参数）。
      // 结构化输出由 System Prompt 的 JSONL 事件模板保证。
      for await (const chunk of provider.streamChat(messages, {
        ...resolved.config,
      })) {
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
          if (charts.length < MAX_CHARTS) {
            charts.push(c.id ? c : { ...c, id: randomUUID() });
          }
        }
        for (const t of rescuedTables) {
          if (tables.length < MAX_TABLES) {
            tables.push(t.id ? t : { ...t, id: randomUUID() });
          }
        }
        this.logger.log(
          `[fallback] rescued charts=${rescuedCharts.length} tables=${rescuedTables.length}`,
        );
      }

      // ── 8. 组装 summary / insights / 正文 ───────────────────
      yield { type: 'progress', stage: 'rendering', percent: 85 };

      let summary = state.summaryText.trim();
      const insights = state.insightsList;
      let cleanContent = state.cleanContent;

      // 补充回退：AI 漏掉 summary/insights 事件时，从正文（如含"分析摘要/关键发现"章节）提取
      if (!summary || insights.length === 0) {
        const { summary: s, insights: i } =
          this.extractSummaryAndInsights(cleanContent);
        if (!summary) summary = s || (insights.length > 0 ? insights[0] : '');
        insights.push(...i.filter((x) => !insights.includes(x)));
      }

      // 兜底：AI 未输出 reports 正文时，用 summary + insights 拼装 Markdown 正文
      if (!state.cleanContent.trim()) {
        const parts: string[] = [];
        if (summary) parts.push(`## 分析摘要\n\n${summary}`);
        if (insights.length > 0) {
          parts.push(
            `## 关键发现\n\n${insights.map((x) => `- ${x}`).join('\n')}`,
          );
        }
        if (parts.length > 0) {
          const assembled = parts.join('\n\n');
          cleanContent = assembled;
          state.cleanContent = assembled;
        }
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
   * 将解析出的 JSONL 事件按五事件协议分类：
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
        case 'chart': {
          // 解析器产出的 payload 不保证带 id（模型通常不输出），补唯一 id：
          // 保证流式渲染 React key 唯一，且 setComplete mergeById 能正确去重，
          // 避免流式图表与 complete payload 图表重复渲染。
          const chartWithId: ChartConfig = event.payload.id
            ? event.payload
            : { ...event.payload, id: randomUUID() };
          if (state.charts.length < MAX_CHARTS) {
            state.charts.push(chartWithId);
          }
          yield { type: 'chart', chart: chartWithId };
          break;
        }
        case 'table': {
          const tableWithId: TableConfig = event.payload.id
            ? event.payload
            : { ...event.payload, id: randomUUID() };
          if (state.tables.length < MAX_TABLES) {
            state.tables.push(tableWithId);
          }
          yield { type: 'table', table: tableWithId };
          break;
        }
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

  /** System Prompt：角色 + 任务目标 + JSONL 事件枚举协议（统一 data 信封，模板复制式） */
  private buildSystemPrompt(): string {
    return `
    你是一个 JSONL 数据分析协议生成器。你的输出会被程序直接解析。

不要输出聊天内容、解释文字、分析步骤或思考过程，只输出符合协议的 JSONL。

## 1. JSONL 协议

* 只能输出 JSONL。
* 每行必须是一个完整、独立的 JSON 对象。
* 每行只能包含 \`event\` 和 \`data\` 两个字段。
* 不得输出 Markdown 代码块。
* 不得使用 \` \`\`\`json \` 或 \` \`\`\` \` 包裹 JSON。
* 不得输出顶层 JSON 数组。
* 不得输出协议之外的字段。
* 不得输出新的 event 类型。
* \`data\` 中必须使用最终计算值，不得输出计算表达式。
* 不得虚构、修改或推测输入数据。

## 2. event 类型

\`event\` 只能是：

* \`summary\`
* \`insights\`
* \`chart\`
* \`table\`
* \`report\`

禁止使用其他名称，例如：

\`\`\`json
{"event":"数据概览","data":{}}
{"event":"销售趋势分析","data":{}}
{"event":"trend_chart","data":{}}
{"event":"summary_conclusion","data":{}}
\`\`\`

正确：

\`\`\`json
{"event":"summary","data":"总结"}
{"event":"chart","data":{}}
{"event":"report","data":{}}
\`\`\`

## 3. 输出顺序

必须严格按照以下顺序输出：

1. \`summary\`：1 次
2. \`insights\`：1 次
3. \`chart\`：0-${MAX_CHARTS} 次
4. \`table\`：0-${MAX_TABLES} 次
5. \`report\`：至少 1 次

事件顺序是输出协议，不代表分析思考过程。

禁止输出“分析开始”“数据概览”“正在分析”等额外事件。

## 4. summary

必须且只能输出一次。

用途：用 1-2 句话总结数据整体情况和核心结论。

格式：

\`\`\`json
{"event":"summary","data":"整体情况总结"}
\`\`\`

## 5. insights

必须且只能输出一次。

用途：输出 3-5 条最重要的发现。

格式：

\`\`\`json
{"event":"insights","data":["发现1","发现2","发现3"]}
\`\`\`

只输出有数据依据的发现，不得虚构结论。

## 6. chart

可输出 0-${MAX_CHARTS} 次。

仅当数据存在有分析价值的趋势、比较或占比关系时生成图表。

禁止为了满足数量要求强行生成图表。

### 通用格式

\`\`\`json
{"event":"chart","data":{
  "type":"line",
  "title":"图表标题",
  "data":[
    {"月份":"1月","销售额":12000},
    {"月份":"2月","销售额":15000}
  ]
}}
\`\`\`

要求：

* \`type\` 只能是 \`line\`、\`bar\`、\`pie\`。
* \`data\` 必须是对象数组。
* 每个对象代表一条图表数据。
* X 轴维度必须作为对象字段。
* 数值指标必须作为对象字段。
* 图表数据必须来自输入数据或对输入数据进行合理聚合。
* 不得虚构数据。
* 不得自行填补缺失数据。
* 不得使用 \`series\`、\`values\`、\`points\`、\`x_axis\`、\`y_axis\` 等其他结构。

### line：时间趋势

用于时间序列趋势。

必须存在日期、时间、月份、季度等有序时间维度。

X 轴使用时间维度，Y 轴使用数值指标。

示例：

\`\`\`json
{"event":"chart","data":{
  "type":"line",
  "title":"月度销售额趋势",
  "data":[
    {"月份":"1月","销售额":12000},
    {"月份":"2月","销售额":15000},
    {"月份":"3月","销售额":18000}
  ]
}}
\`\`\`

### bar：类别比较

用于不同类别之间的数值比较。

必须存在分类维度和数值指标。

示例：

\`\`\`json
{"event":"chart","data":{
  "type":"bar",
  "title":"各产品销售额对比",
  "data":[
    {"产品":"A","销售额":12000},
    {"产品":"B","销售额":18000},
    {"产品":"C","销售额":15000}
  ]
}}
\`\`\`

### pie：占比分布

用于展示总体构成或占比。

必须存在一个分类维度和一个非负数值指标。

\`data\` 应使用按类别聚合后的结果，不应直接使用大量明细记录。

类别过多时不要使用 pie，应优先使用 bar。

示例：

\`\`\`json
{"event":"chart","data":{
  "type":"pie",
  "title":"各产品销售额占比",
  "data":[
    {"产品":"A","销售额":300},
    {"产品":"B","销售额":300},
    {"产品":"C","销售额":400}
  ]
}}
\`\`\`

## 7. table

可输出 0-${MAX_TABLES} 次。

用于展示明细数据或结构化记录。

格式：

\`\`\`json
{"event":"table","data":{
  "title":"销售明细",
  "columns":["产品","数量","销售额"],
  "data":[
    {"产品":"A","数量":100,"销售额":12000}
  ]
}}
\`\`\`

要求：

* \`columns\` 必须与每条 \`data\` 记录的字段完全一致。
* 不得增加未声明字段。
* 数据必须来自输入数据。
* 不得虚构记录。
* 表格用于结构化数据展示，不用于替代有分析价值的图表。

## 8. report

必须至少输出一次。

用于输出最终分析报告。

每个 \`report\` 事件只能包含一个章节。

格式：

\`\`\`json
{"event":"report","data":{
  "title":"销售趋势分析",
  "content":"## 销售趋势\n\n本期销售额整体呈增长趋势。"
}}
\`\`\`

要求：

* \`title\` 为章节标题。
* \`content\` 为 Markdown 字符串。
* Markdown 只能出现在 \`report.data.content\` 中。
* JSON 字符串中的换行必须使用 \`\\n\` 转义。
* 不要把完整报告放入单个 report 事件。
* 每个 report 事件只描述一个章节。

## 9. 最终要求

最终输出必须满足：

\`\`\`text
summary
→ insights
→ chart（可选）
→ table（可选）
→ report
\`\`\`

除上述 JSONL 事件外，不得输出任何其他内容。
`;
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
      ? '\n【硬性要求】用户需求中明确要求输出图表，必须至少输出 1 个 chart 事件，图表数据必须基于数据摘要中的真实统计值。'
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

请严格按 System Prompt 的 JSONL 事件协议逐行输出事件对象，所有事件必须使用统一的 {"event":"...","data":...} 结构，不要输出 JSON 以外的任何内容。`;
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
