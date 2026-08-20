import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { randomUUID } from 'crypto';
import { AnalysisSession } from './entities/analysis-session.entity';
import { AnalysisFile } from './entities/analysis-file.entity';
import { AnalysisChart } from './entities/analysis-chart.entity';
import { AnalysisResult } from './entities/analysis-result.entity';
import type { ChartConfig } from '@repo/types';

/** 一小时毫秒数 */
const ONE_HOUR = 60 * 60 * 1000;

@Injectable()
export class AnalysisService {
  constructor(
    @InjectModel(AnalysisSession)
    private sessionModel: typeof AnalysisSession,
    @InjectModel(AnalysisFile)
    private fileModel: typeof AnalysisFile,
    @InjectModel(AnalysisChart)
    private chartModel: typeof AnalysisChart,
    @InjectModel(AnalysisResult)
    private resultModel: typeof AnalysisResult,
  ) {}

  // ── File Upload ─────────────────────────────────────────────

  async saveFileRecord(
    analysisId: string | null,
    fileName: string,
    fileUrl: string,
    size: number,
  ): Promise<AnalysisFile> {
    return this.fileModel.create({
      analysisId,
      fileName,
      fileUrl,
      size,
      expireAt: new Date(Date.now() + 24 * ONE_HOUR), // 24h 后过期
    });
  }

  /** 根据 analysisId 获取关联的文件记录 */
  async getFileByAnalysisId(analysisId: string): Promise<AnalysisFile | null> {
    return this.fileModel.findOne({ where: { analysisId } });
  }

  // ── Session CRUD ────────────────────────────────────────────

  async createSession(
    userId: number,
    dto: { fileId: string; prompt: string; model: string; title: string },
  ): Promise<AnalysisSession> {
    const session = await this.sessionModel.create({
      id: randomUUID(),
      userId,
      title: dto.title,
      prompt: dto.prompt,
      status: 'PENDING',
      model: dto.model,
    });

    // 关联文件到 session
    const file = await this.fileModel.findByPk(dto.fileId);
    if (file) {
      await file.update({ analysisId: session.id });
    }

    return session;
  }

  async updateStatus(
    sessionId: string,
    status: 'PENDING' | 'ANALYZING' | 'COMPLETED' | 'FAILED',
  ): Promise<void> {
    await this.sessionModel.update({ status }, { where: { id: sessionId } });
  }

  async getSession(
    userId: number,
    sessionId: string,
  ): Promise<AnalysisSession> {
    const session = await this.sessionModel.findByPk(sessionId);
    if (!session) {
      throw new NotFoundException('分析任务不存在');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('无权访问此分析任务');
    }
    return session;
  }

  // ── List ────────────────────────────────────────────────────

  async listSessions(userId: number, page = 1, limit = 20, keyword?: string) {
    const offset = (page - 1) * limit;
    const { rows, count } = await this.sessionModel.findAndCountAll({
      where: {
        userId,
        ...(keyword ? { title: { [Op.like]: `%${keyword}%` } } : {}),
      },
      attributes: ['id', 'title', 'status', 'model', 'created_at'],
      order: [['created_at', 'DESC']],
      offset,
      limit,
    });

    // 批量查询每个 session 的文件名和图表数量
    const sessionIds = rows.map((s) => s.id);
    const files = sessionIds.length
      ? await this.fileModel.findAll({
          where: { analysisId: { [Op.in]: sessionIds } },
          attributes: ['analysisId', 'fileName'],
        })
      : [];
    const chartCounts = sessionIds.length
      ? await this.chartModel.findAll({
          where: { analysisId: { [Op.in]: sessionIds } },
          attributes: ['analysisId'],
        })
      : [];

    const fileMap = new Map(files.map((f) => [f.analysisId, f.fileName]));
    const chartCountMap = new Map<string, number>();
    chartCounts.forEach((c) => {
      chartCountMap.set(
        c.analysisId,
        (chartCountMap.get(c.analysisId) ?? 0) + 1,
      );
    });

    return {
      items: rows.map((s) => ({
        id: s.id,
        title: s.title,
        fileName: fileMap.get(s.id),
        chartCount: chartCountMap.get(s.id) ?? 0,
        status: s.status,
        createdAt: (s as any).created_at,
      })),
      page,
      total: count,
      hasMore: offset + limit < count,
    };
  }

  // ── Delete / Update ────────────────────────────────────────

  /** 删除分析任务（级联删除文件/图表/结果记录） */
  async deleteSession(userId: number, sessionId: string) {
    const session = await this.getSession(userId, sessionId);

    await this.fileModel.destroy({ where: { analysisId: sessionId } });
    await this.chartModel.destroy({ where: { analysisId: sessionId } });
    await this.resultModel.destroy({ where: { analysisId: sessionId } });
    await session.destroy();
    return { success: true };
  }

  /** 更新分析任务（目前仅支持重命名标题） */
  async updateSession(
    userId: number,
    sessionId: string,
    dto: { title?: string },
  ) {
    const session = await this.getSession(userId, sessionId);

    const updateData: any = {};
    if (dto.title !== undefined) updateData.title = dto.title;

    await session.update(updateData);
    return session;
  }

  // ── Detail ──────────────────────────────────────────────────

  async getDetail(userId: number, sessionId: string) {
    const session = await this.getSession(userId, sessionId);

    const file = await this.fileModel.findOne({
      where: { analysisId: sessionId },
      attributes: ['fileName', 'size'],
    });

    const charts = await this.chartModel.findAll({
      where: { analysisId: sessionId },
      order: [['created_at', 'ASC']],
    });

    const result = await this.resultModel.findOne({
      where: { analysisId: sessionId },
    });

    return {
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        model: session.model,
        createdAt: (session as any).created_at,
      },
      file: file ? { fileName: file.fileName, size: file.size } : undefined,
      charts: charts.map((c) => ({
        id: c.id.toString(),
        ...(c.chartConfig as any),
      })),
      tables: [], // tables are stored inside result.content as markdown
      result: result
        ? {
            summary: result.summary,
            content: result.content,
            charts: charts.map((c) => ({
              id: c.id.toString(),
              ...(c.chartConfig as any),
            })),
            tables: [],
            insights: result.insights ?? [],
          }
        : null,
    };
  }

  // ── Save Results ────────────────────────────────────────────

  async saveCharts(analysisId: string, charts: ChartConfig[]): Promise<void> {
    if (charts.length === 0) return;
    await this.chartModel.bulkCreate(
      charts.map((c) => ({
        analysisId,
        chartType: c.type,
        chartConfig: {
          type: c.type,
          title: c.title,
          data: c.data,
          option: c.option,
          id: c.id,
        },
      })),
    );
  }

  async saveResult(
    analysisId: string,
    data: { summary: string; content: string; insights: string[] },
  ): Promise<void> {
    await this.resultModel.create({
      analysisId,
      summary: data.summary,
      content: data.content,
      insights: data.insights,
    });
  }

  // ── Cleanup ─────────────────────────────────────────────────

  /** 清理过期文件（可由定时任务调用） */
  async cleanupExpiredFiles(): Promise<number> {
    const expired = await this.fileModel.findAll({
      where: { expireAt: { [Op.lt]: new Date() } },
    });
    // TODO: 同时删除磁盘上的文件
    const ids = expired.map((f) => f.id);
    if (ids.length > 0) {
      await this.fileModel.destroy({ where: { id: { [Op.in]: ids } } });
    }
    return ids.length;
  }
}
