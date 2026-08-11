import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { ThinkTagParser, JsonlStreamParser } from '@repo/analysis-parser';
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

      const aiPrompt = this.buildPrompt({
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

      const messages = [{ role: 'user' as const, content: aiPrompt }];

      let fullText = ''; // 原始 JSONL 文本（不含 thinking）
      const charts: ChartConfig[] = [];
      const tables: TableConfig[] = [];
      const thinkParser = new ThinkTagParser();

      // ── 7. 流式接收 + Think 解析 ──────────────────────────
      let textStarted = false;

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
            // answer 部分 → 作为原始 JSONL 文本直接发送给客户端
            fullText += tr.content;

            if (!textStarted) {
              textStarted = true;
              yield { type: 'progress', stage: 'analyzing', percent: 50 };
            }

            // 客户端负责 JsonlStreamParser 解析和渲染
            yield { type: 'analysis_delta', delta: tr.content };
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
          yield { type: 'analysis_delta', delta: tr.content };
        }
      }

      // ── Post-stream: 解析 fullText 提取 charts/tables + 清洁文本用于持久化 ──
      let cleanContent = '';
      const postParser = new JsonlStreamParser({
        onDebug: (msg) => this.logger.debug(msg),
      });
      for (const event of postParser.feed(fullText)) {
        if (event.type === 'text') {
          cleanContent += event.content;
        } else if (event.type === 'chart' && charts.length < MAX_CHARTS) {
          charts.push(event.payload);
        } else if (event.type === 'table' && tables.length < MAX_CHARTS) {
          tables.push(event.payload);
        }
      }
      // Flush 残余 JSON
      for (const event of postParser.flush()) {
        if (event.type === 'text') {
          cleanContent += event.content;
        } else if (event.type === 'chart' && charts.length < MAX_CHARTS) {
          charts.push(event.payload);
        } else if (event.type === 'table' && tables.length < MAX_CHARTS) {
          tables.push(event.payload);
        }
      }

      // ── 8. 提取 insights ────────────────────────────────────
      yield { type: 'progress', stage: 'rendering', percent: 85 };

      const insights = this.extractInsights(cleanContent);

      // ── 9. 持久化结果（不含 thinking） ──────────────────────
      await this.analysisService.saveCharts(sessionId, charts);
      await this.analysisService.saveResult(sessionId, {
        summary: insights[0] ?? '分析完成',
        content: cleanContent,
        insights,
      });

      // ── 10. 状态 → COMPLETED ────────────────────────────────
      await this.analysisService.updateStatus(sessionId, 'COMPLETED');

      yield {
        type: 'complete',
        payload: {
          summary: insights[0] ?? '分析完成',
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

  // ── Prompt Builder ────────────────────────────────────────

  /** 构建 JSONL 格式的分析 Prompt */
  private buildPrompt(params: {
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

    // 构建列摘要（紧凑格式）
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

    return `你是一个数据分析专家。请根据以下**数据摘要**进行分析。注意：你只能看到摘要和样本，看不到全量原始数据。

【数据摘要】
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
${userPrompt}

【输出格式 — 严格 JSONL】
你必须逐行输出 JSON 事件。每行一个完整的 JSON 对象。

**关键规则：JSON 字符串内的换行必须转义为 \\n，禁止输出真实换行符。**
正确示例：{"type":"text","delta":"第一行\\n第二行"}
错误示例：{"type":"text","delta":"第一行
第二行"}

事件类型（每行一个）：
1. 文本段落：
{"type":"text","delta":"Markdown 分析文本（换行用 \\\\n）"}

2. 图表（仅当数据特征适合时使用，最多 ${MAX_CHARTS} 个）：
{"type":"chart","chart":{"id":"c1","type":"bar","title":"标题","data":[{"name":"类目","value":数值}]}}
   - type: bar(类别对比) / line(时间趋势) / pie(占比分布)
   - data 中放计算后的聚合数值，不要放原始数据

3. 表格（仅当需要展示结构化数据时使用）：
{"type":"table","table":{"id":"t1","title":"标题","columns":["列1","列2"],"data":[{"列1":"值","列2":"值"}]}}

图表生成策略：
- 类别对比数据（如各产品销售额）→ bar
- 时间序列数据（如月度变化）→ line
- 占比分布数据（如市场份额）→ pie
- 不是所有数据都需要图表，文字能说清的不要强行画图
- 若某列 uniqueCount > 20，不适合作为饼图分类维度

禁止：
- 输出 Python/pandas/SQL 代码
- 在 JSON 行外添加任何文字说明
- 将图表 JSON 放在 markdown 代码块（\`\`\`）内`;
  }

  // ── Insights Extraction ───────────────────────────────────

  /** 从分析文本中提取关键词/洞察 */
  private extractInsights(text: string): string[] {
    const insights: string[] = [];
    const pattern =
      /(?:\*\*关键发现\*\*|\*\*主要发现\*\*|关键发现|主要发现)[:：]\s*\n([\s\S]*?)(?=\n\n|$)/;
    const match = text.match(pattern);
    if (match) {
      const lines = match[1]
        .split('\n')
        .map((l) => l.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
      insights.push(...lines);
    }

    if (insights.length === 0) {
      const firstParagraph = text.split('\n\n')[0];
      if (firstParagraph) {
        insights.push(firstParagraph.replace(/^#+\s*/, '').trim());
      }
    }

    return insights;
  }
}
