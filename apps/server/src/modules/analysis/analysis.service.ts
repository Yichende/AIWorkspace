import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { randomUUID } from 'crypto';
import { resolveUploadPath, safeUnlink } from '../../common/fs.util';
import { AnalysisSession } from './entities/analysis-session.entity';
import { AnalysisFile } from './entities/analysis-file.entity';
import { AnalysisChart } from './entities/analysis-chart.entity';
import { AnalysisResult } from './entities/analysis-result.entity';
import { AnalysisTable } from './entities/analysis-table.entity';
import { AnalysisTask } from './entities/analysis-task.entity';
import type { ChartConfig, ProgressStage, TableConfig } from '@repo/types';

/** 一小时毫秒数 */
const ONE_HOUR = 60 * 60 * 1000;

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    @InjectModel(AnalysisSession)
    private sessionModel: typeof AnalysisSession,
    @InjectModel(AnalysisFile)
    private fileModel: typeof AnalysisFile,
    @InjectModel(AnalysisChart)
    private chartModel: typeof AnalysisChart,
    @InjectModel(AnalysisResult)
    private resultModel: typeof AnalysisResult,
    @InjectModel(AnalysisTable)
    private tableModel: typeof AnalysisTable,
    @InjectModel(AnalysisTask)
    private taskModel: typeof AnalysisTask,
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
      // 过期文件已进入清理队列，此时再关联会被清理掉 → 直接拒绝
      if (file.expireAt && file.expireAt.getTime() < Date.now()) {
        throw new NotFoundException('文件已过期，请重新上传');
      }
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

  /** worker 用：按 id 取会话（无归属校验，不抛 NotFound） */
  async getSessionById(sessionId: string): Promise<AnalysisSession | null> {
    return this.sessionModel.findByPk(sessionId);
  }

  /** 只取状态（僵死回收的对账用），不存在返回 null */
  async getSessionStatus(sessionId: string): Promise<string | null> {
    const row = await this.sessionModel.findByPk(sessionId, {
      attributes: ['status'],
    });
    return row?.status ?? null;
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

  /** 删除分析任务（级联删除文件/图表/结果记录，含磁盘上的上传文件） */
  async deleteSession(userId: number, sessionId: string) {
    const session = await this.getSession(userId, sessionId);

    // 先删磁盘再删记录：反过来一旦删除失败，记录没了 → 文件永久泄漏
    const files = await this.fileModel.findAll({
      where: { analysisId: sessionId },
    });
    for (const f of files) {
      safeUnlink(resolveUploadPath(f.fileUrl));
    }

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

    const [file, charts, tables, result, task] = await Promise.all([
      this.fileModel.findOne({
        where: { analysisId: sessionId },
        attributes: ['fileName', 'size'],
      }),
      this.chartModel.findAll({
        where: { analysisId: sessionId },
        order: [['created_at', 'ASC']],
      }),
      this.tableModel.findAll({
        where: { analysisId: sessionId },
        order: [['created_at', 'ASC']],
      }),
      this.resultModel.findOne({
        where: { analysisId: sessionId },
      }),
      // 最新一行任务。进度与失败原因此前没有任何 HTTP 出口 ——
      // 刷新页面后客户端就再也拿不到，只剩一句「分析失败」。
      this.taskModel.findOne({
        where: { sessionId },
        order: [['id', 'DESC']],
      }),
    ]);

    const chartList = charts.map((c) => ({
      id: c.id.toString(),
      ...(c.chartConfig as any),
    }));
    // 表格此前恒为 []（注释写着 "stored inside result.content as markdown"），
    // 导致「实时流里看得到表格、重开详情页就没了」。现在读真表。
    const tableList = tables.map((t) => ({
      id: t.id.toString(),
      ...(t.tableConfig as any),
    }));

    const progressPercent = task?.progressPercent ?? null;

    return {
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        model: session.model,
        createdAt: (session as any).created_at,
      },
      file: file ? { fileName: file.fileName, size: file.size } : undefined,
      charts: chartList,
      tables: tableList,
      result: result
        ? {
            summary: result.summary,
            content: result.content,
            charts: chartList,
            tables: tableList,
            insights: result.insights ?? [],
          }
        : null,
      progress:
        progressPercent === null
          ? null
          : {
              // 任务刚入队时 progress_stage 还是 null（百分比为 0），
              // 兜底成 'analyzing' —— 客户端进度条的文案本就由事件驱动，
              // 这里只负责百分比落位。
              stage: (task?.progressStage ?? 'analyzing') as ProgressStage,
              percent: progressPercent,
            },
      errorMessage: task?.errorMessage ?? null,
    };
  }

  // ── Save Results ────────────────────────────────────────────

  async saveCharts(analysisId: string, charts: ChartConfig[]): Promise<void> {
    // 先清后插：重跑（崩溃自动重试）时会再次调用，不去重会累积重复图表。
    // 也顺带修掉了旧实现里「第二个订阅者各跑一遍 → 双份图表」的问题。
    await this.chartModel.destroy({ where: { analysisId } });
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

  async saveTables(analysisId: string, tables: TableConfig[]): Promise<void> {
    // 与 saveCharts 同样的先清后插：崩溃重跑会再次调用，不去重会累积重复表格
    await this.tableModel.destroy({ where: { analysisId } });
    if (tables.length === 0) return;
    await this.tableModel.bulkCreate(
      tables.map((t) => ({
        analysisId,
        tableConfig: {
          id: t.id,
          title: t.title,
          columns: t.columns,
          data: t.data,
        },
      })),
    );
  }

  async saveResult(
    analysisId: string,
    data: { summary: string; content: string; insights: string[] },
  ): Promise<void> {
    // 同上：重跑必须覆盖上一次的结果行，而不是再插一行
    await this.resultModel.destroy({ where: { analysisId } });
    await this.resultModel.create({
      analysisId,
      summary: data.summary,
      content: data.content,
      insights: data.insights,
    });
  }

  // ── Cleanup ─────────────────────────────────────────────────

  /**
   * 清理过期文件：删除磁盘文件 + DB 记录，返回真正清掉的文件数。
   *
   * - EXPIRED 判定看 `expire_at`（upload 时写入 = 上传时刻 + 24h）
   * - 但仍在 PENDING/ANALYZING 的会话所关联的文件不删：文件在 create 时才关联会话，
   *   分析完全可能在 24h 边缘才开始，删掉会让进行中的任务失去数据源
   * - 顺序为「先删盘、后删记录」：反过来一旦磁盘删除失败，记录已没了 → 文件永久泄漏；
   *   先删盘最坏只留下一条指向缺失文件的记录，`execute()` 会报「文件已过期，请重新上传」
   * - 逐条 try/catch：单条失败不阻断整批
   */
  async cleanupExpiredFiles(): Promise<number> {
    const candidates = await this.fileModel.findAll({
      where: { expireAt: { [Op.lt]: new Date() } },
    });
    if (candidates.length === 0) return 0;

    const linkedIds = candidates
      .map((f) => f.analysisId)
      .filter((id): id is string => !!id);
    const activeIds = new Set(
      linkedIds.length === 0
        ? []
        : (
            await this.sessionModel.findAll({
              where: {
                id: { [Op.in]: linkedIds },
                status: { [Op.in]: ['PENDING', 'ANALYZING'] },
              },
              attributes: ['id'],
            })
          ).map((s) => s.id),
    );

    let removed = 0;
    for (const file of candidates) {
      if (file.analysisId && activeIds.has(file.analysisId)) continue;
      safeUnlink(resolveUploadPath(file.fileUrl));
      try {
        await file.destroy();
        removed++;
      } catch (err: any) {
        this.logger.error(
          `删除文件记录失败 id=${file.id}: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      `[cleanup] 过期文件清理完成 removed=${removed} skipped=${candidates.length - removed}`,
    );
    return removed;
  }

  /**
   * 把长时间停留在 ANALYZING 的会话置为 FAILED，返回受影响的行数。
   *
   * ANALYZING 会「僵死」的两个来源，两者都不会再有人推进状态：
   *   1. 客户端断开（小程序切后台 / 退出）—— 上游已中止，但按 P0-3 的语义
   *      刻意不落终态（避免切后台几秒回来就看到「分析失败」）
   *   2. 服务重启 / 崩溃时正在执行的任务
   * 不清理就会永久堆在「分析中」，所以用「远超单次分析合理时长」的阈值兜底。
   *
   * @param maxAgeMs 距最后一次状态变更超过该时长即判定僵死
   * @param excludeSessionIds 要排除的会话（心跳新鲜的运行中会话）——
   *   否则一次合法的 >2h 长跑会因为会话 `updated_at` 不动而被误杀。
   *   默认空数组，保持既有调用方与单测不变。
   */
  async failStaleAnalyzingSessions(
    maxAgeMs: number,
    excludeSessionIds: string[] = [],
  ): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const [affected] = await this.sessionModel.update(
      { status: 'FAILED' },
      {
        where: {
          status: 'ANALYZING',
          updated_at: { [Op.lt]: cutoff },
          ...(excludeSessionIds.length > 0
            ? { id: { [Op.notIn]: excludeSessionIds } }
            : {}),
        },
      },
    );

    if (affected > 0) {
      this.logger.warn(
        `[cleanup] ${affected} 个 ANALYZING 会话超过 ${Math.round(maxAgeMs / 60000)} 分钟未完成，已置为 FAILED`,
      );
    }
    return affected;
  }
}
