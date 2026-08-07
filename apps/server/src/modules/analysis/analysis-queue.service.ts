import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { ModelResolver, ResolvedModel } from '../chat/model-resolver.service';
import { ProviderFactory } from '../chat/providers/provider-factory.service';
import { AnalysisService } from './analysis.service';
import type { ChartConfig, TableConfig } from '@repo/types';

export interface AnalysisEvent {
  type: 'status' | 'text' | 'chart' | 'table' | 'complete' | 'error';
  content: string;
}

/** LLM 上下文最大行数 */
const MAX_ROWS_FOR_LLM = 1000;

/** 统计摘要需要的最小行数 */
const MIN_ROWS_FOR_STATS = 10;

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
    yield { type: 'status', content: '正在准备分析...' };

    try {
      // ── 2. 读取文件并解析 ──────────────────────────────────
      await this.analysisService.getSession(userId, sessionId);
      const fileRecord =
        await this.analysisService.getFileByAnalysisId(sessionId);

      if (!fileRecord) {
        throw new Error('文件记录不存在，请重新上传文件');
      }

      yield { type: 'status', content: '✓ 已读取数据' };

      const filePath = fileRecord.fileUrl;
      if (!fs.existsSync(filePath)) {
        throw new Error('文件已过期，请重新上传');
      }

      // 用 SheetJS 解析
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      yield {
        type: 'status',
        content: `✓ 已识别字段：${columns.join('、')}`,
      };

      // ── 3. 生成数据摘要 ────────────────────────────────────
      const rowCount = rows.length;
      const columnCount = columns.length;
      const sampleSize = Math.min(rowCount, MAX_ROWS_FOR_LLM);
      const sample = rows.slice(0, sampleSize);

      // 类型推断 + 基本统计
      const columnTypes = this.inferColumnTypes(columns, sample);
      const statistics =
        rowCount >= MIN_ROWS_FOR_STATS
          ? this.computeStatistics(columns, rows)
          : undefined;

      yield {
        type: 'status',
        content: `✓ 正在计算指标（共 ${rowCount} 行 ${columnCount} 列）`,
      };

      // ── 4. 构建 LLM Prompt ─────────────────────────────────
      const aiPrompt = this.buildPrompt({
        fileName: fileRecord.fileName,
        rowCount,
        columnCount,
        columns,
        columnTypes,
        statistics,
        sample,
        sampleSize,
        userPrompt: prompt,
      });

      // ── 5. 调用 AI Provider ────────────────────────────────
      const resolved: ResolvedModel = await this.modelResolver.resolve(
        userId,
        model,
      );
      const provider = this.providerFactory.getProvider(resolved.protocolType);

      yield { type: 'status', content: '✓ 正在生成分析结论' };

      const messages = [
        {
          role: 'user' as const,
          content: aiPrompt,
        },
      ];

      let fullText = '';
      let buffer = '';
      const charts: ChartConfig[] = [];
      const tables: TableConfig[] = [];

      // 流式接收 AI 输出
      for await (const chunk of provider.streamChat(
        messages,
        resolved.config,
      )) {
        if (chunk.type === 'thinking') {
          // 跳过 thinking，不暴露给客户端
          continue;
        }

        buffer += chunk.content;
        fullText += chunk.content;

        // 解析 [CHART]...[/CHART] 和 [TABLE]...[/TABLE] 标记
        const parsed = this.parseMarkers(buffer);
        buffer = parsed.remainder;

        // 发送文本增量
        if (parsed.textDelta) {
          yield { type: 'text', content: parsed.textDelta };
        }

        // 发送图表
        for (const chart of parsed.charts) {
          charts.push(chart);
          yield {
            type: 'chart',
            content: JSON.stringify(chart),
          };
        }

        // 发送表格
        for (const table of parsed.tables) {
          tables.push(table);
          yield {
            type: 'table',
            content: JSON.stringify(table),
          };
        }
      }

      // 处理剩余 buffer
      if (buffer.trim()) {
        yield { type: 'text', content: buffer };
      }

      // ── 6. 提取 insights ───────────────────────────────────
      const insights = this.extractInsights(fullText);

      // ── 7. 持久化结果 ──────────────────────────────────────
      await this.analysisService.saveCharts(sessionId, charts);
      await this.analysisService.saveResult(sessionId, {
        summary: insights[0] ?? '分析完成',
        content: fullText,
        insights,
      });

      // ── 8. 状态 → COMPLETED ────────────────────────────────
      await this.analysisService.updateStatus(sessionId, 'COMPLETED');

      yield {
        type: 'complete',
        content: JSON.stringify({
          summary: insights[0] ?? '分析完成',
          charts,
          tables,
          insights,
        }),
      };
    } catch (err: any) {
      this.logger.error(`Analysis failed for session ${sessionId}:`, err);
      await this.analysisService.updateStatus(sessionId, 'FAILED');
      yield {
        type: 'error',
        content: err.message || '分析失败，请重试',
      };
    }
  }

  // ── Private Helpers ─────────────────────────────────────────

  /** 推断每列的数据类型 */
  private inferColumnTypes(
    columns: string[],
    sample: Record<string, any>[],
  ): Record<string, string> {
    const types: Record<string, string> = {};
    for (const col of columns) {
      const values = sample.map((r) => r[col]).filter((v) => v != null);
      if (values.length === 0) {
        types[col] = 'unknown';
        continue;
      }
      const allNumbers = values.every((v) => !isNaN(Number(v)));
      if (allNumbers) {
        types[col] = 'number';
        continue;
      }
      // 简单日期检测
      const datePattern = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
      const allDates = values.every(
        (v) => datePattern.test(String(v)) && !isNaN(Date.parse(String(v))),
      );
      if (allDates) {
        types[col] = 'date';
        continue;
      }
      types[col] = 'string';
    }
    return types;
  }

  /** 计算基本统计量 */
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
        missingCount: rows.length - values.length,
      };
    }
    return stats;
  }

  private round(n: number, decimals = 2): number {
    return Math.round(n * 10 ** decimals) / 10 ** decimals;
  }

  /** 构建发给 LLM 的分析 Prompt */
  private buildPrompt(params: {
    fileName: string;
    rowCount: number;
    columnCount: number;
    columns: string[];
    columnTypes: Record<string, string>;
    statistics?: Record<string, any>;
    sample: Record<string, any>[];
    sampleSize: number;
    userPrompt: string;
  }): string {
    const {
      fileName,
      rowCount,
      columnCount,
      columnTypes,
      statistics,
      sample,
      sampleSize,
      userPrompt,
    } = params;

    let statsSection = '';
    if (statistics) {
      statsSection = `\n- 统计摘要:\n\`\`\`json\n${JSON.stringify(statistics, null, 2)}\n\`\`\``;
    }

    const capacityNote =
      rowCount > MAX_ROWS_FOR_LLM
        ? `\n> ⚠️ 数据共 ${rowCount} 行，已截取前 ${sampleSize} 行作为分析样本。统计摘要是基于全量数据计算的。`
        : '';

    return `你是一个数据分析专家。请根据以下数据进行分析：

【数据摘要】
- 文件名: ${fileName}
- 行数: ${rowCount}（已截取前 ${sampleSize} 行作为样本）
- 列数: ${columnCount}
- 字段及类型: ${JSON.stringify(columnTypes)}${statsSection}
- 样本数据:
\`\`\`json
${JSON.stringify(sample.slice(0, 5), null, 2)}
\`\`\`
${capacityNote}

【用户需求】
${userPrompt}

【输出格式要求】
1. 先输出 Markdown 格式的分析结论（含标题、段落、列表）
2. 需要图表时请用以下格式：
   [CHART]{"id":"唯一ID","type":"line|bar|pie","title":"标题","data":[...],"option":{...可选}}[/CHART]
   - id 必须唯一
   - type 支持 line/bar/pie
   - data 数组中的对象应包含可直接用于图表渲染的字段
   - option 可选，用于透传 ECharts 配置覆盖
3. 需要表格时请用以下格式：
   [TABLE]{"id":"唯一ID","title":"标题","columns":["列1","列2"],"data":[...]}[/TABLE]
4. 关键发现请用 "**关键发现**:" 开头，每行一条，用 "- " 列表格式
5. 至少输出 2-3 个图表或表格，结合文字分析`;
  }

  /**
   * 解析 AI 输出流中的 [CHART] 和 [TABLE] 标记。
   *
   * 采用增量解析策略：识别完整标记后立即提取，未闭合的标记保留在 buffer 中。
   */
  private parseMarkers(buffer: string): {
    textDelta: string;
    charts: ChartConfig[];
    tables: TableConfig[];
    remainder: string;
  } {
    const charts: ChartConfig[] = [];
    const tables: TableConfig[] = [];

    let text = buffer;
    let changed = true;

    // 循环解析，直到没有新的完整标记
    while (changed) {
      changed = false;

      // 尝试解析 [CHART]...[/CHART]
      const chartStart = text.indexOf('[CHART]');
      const chartEnd = text.indexOf('[/CHART]');

      if (chartStart !== -1 && chartEnd !== -1 && chartEnd > chartStart) {
        const before = text.slice(0, chartStart);
        const jsonStr = text.slice(chartStart + 7, chartEnd);
        text = before + text.slice(chartEnd + 8);
        changed = true;

        try {
          const config = JSON.parse(jsonStr);
          if (config.id && config.type && config.title) {
            charts.push(config as ChartConfig);
          }
        } catch {
          // 解析失败，作为普通文本
          text = before + jsonStr + text.slice(chartEnd + 8);
        }
        continue;
      }

      // 尝试解析 [TABLE]...[/TABLE]
      const tableStart = text.indexOf('[TABLE]');
      const tableEnd = text.indexOf('[/TABLE]');

      if (tableStart !== -1 && tableEnd !== -1 && tableEnd > tableStart) {
        const before = text.slice(0, tableStart);
        const jsonStr = text.slice(tableStart + 7, tableEnd);
        text = before + text.slice(tableEnd + 8);
        changed = true;

        try {
          const config = JSON.parse(jsonStr);
          if (config.id && config.columns && config.data) {
            tables.push(config as TableConfig);
          }
        } catch {
          text = before + jsonStr + text.slice(tableEnd + 8);
        }
        continue;
      }

      // 检查是否有未闭合的 [CHART] 或 [TABLE]（保留在 buffer）
      const nextChart = text.indexOf('[CHART]');
      const nextTable = text.indexOf('[TABLE]');
      if (
        (nextChart !== -1 && text.indexOf('[/CHART]') === -1) ||
        (nextTable !== -1 && text.indexOf('[/TABLE]') === -1)
      ) {
        // 找到最后一个未闭合标记的位置
        const cutPoint = Math.min(
          nextChart !== -1 ? nextChart : Infinity,
          nextTable !== -1 ? nextTable : Infinity,
        );
        if (cutPoint < Infinity) {
          const textDelta = text.slice(0, cutPoint);
          return {
            textDelta,
            charts,
            tables,
            remainder: text.slice(cutPoint),
          };
        }
      }
    }

    // 如果所有 CHART/TABLE 标记都完整解析完了
    // 但需要保留可能被截断的最后一个标记
    const lastChartOpen = text.lastIndexOf('[CHART]');
    const lastTableOpen = text.lastIndexOf('[TABLE]');
    const lastChartClose = text.lastIndexOf('[/CHART]');
    const lastTableClose = text.lastIndexOf('[/TABLE]');

    // 存在未闭合的标记 → 从最后一个未闭合处截断
    if (lastChartOpen > lastChartClose || lastTableOpen > lastTableClose) {
      const cutPoint = Math.max(
        lastChartOpen > lastChartClose ? lastChartOpen : -1,
        lastTableOpen > lastTableClose ? lastTableOpen : -1,
      );
      return {
        textDelta: text.slice(0, cutPoint),
        charts,
        tables,
        remainder: text.slice(cutPoint),
      };
    }

    return { textDelta: text, charts, tables, remainder: '' };
  }

  /** 从分析文本中提取关键词/洞察 */
  private extractInsights(text: string): string[] {
    const insights: string[] = [];
    // 匹配 "**关键发现**:" 或 "**主要发现**:" 后的列表
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

    // 如果没有明确的发现列表，提取开头几句作为摘要
    if (insights.length === 0) {
      const firstParagraph = text.split('\n\n')[0];
      if (firstParagraph) {
        insights.push(firstParagraph.replace(/^#+\s*/, '').trim());
      }
    }

    return insights;
  }
}
