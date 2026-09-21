import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { AnalysisTask } from './entities/analysis-task.entity';

/** 心跳间隔：worker 每 30s 续租一次 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * RUNNING 超过该时长没有心跳即判定僵死（10 次漏拍）。
 * 从「进程崩溃」到「被发现」最多约 5 分钟，而非旧兜底的 2 小时。
 */
export const RUNNING_STALE_MS = 5 * 60 * 1000;

/** 排队超时：worker 长期不排空时，避免会话永远停在 PENDING/ANALYZING */
export const QUEUED_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * 允许的最大领取次数（含首次）。超过则落 FAILED，不再重复向厂商付费。
 *
 * 2 = 首次执行 + 崩溃后重跑 1 次。`attempt` 从 0 起、每次 claim 加一，
 * 因此第一次执行后是 1、重跑后是 2。
 */
export const MAX_ATTEMPTS = 2;

/**
 * 分析任务的 DB 操作层。
 *
 * **所有状态跃迁都是带状态守卫的 CAS**（`WHERE id=? AND state=?`）——
 * 这是 cancel / reap / 终态镜像三者互不覆盖的唯一保证。任何"先读再写"的写法
 * 都会引入覆盖窗口。
 */
@Injectable()
export class AnalysisTaskService {
  private readonly logger = new Logger(AnalysisTaskService.name);
  /** 本进程标识，写入 locked_by 便于排查（单进程下也有用） */
  private readonly workerId = `${process.pid}`;

  constructor(
    @InjectModel(AnalysisTask)
    private readonly taskModel: typeof AnalysisTask,
  ) {}

  // ── 入队 ────────────────────────────────────────────────────

  /**
   * 为会话入队一个任务（幂等）：该会话已有未终态任务时直接返回它，
   * 不会重复创建 —— 这是「两个订阅者共享同一个运行」的基础。
   */
  async enqueue(sessionId: string): Promise<AnalysisTask> {
    const existing = await this.findActive(sessionId);
    if (existing) return existing;

    return this.taskModel.create({
      sessionId,
      state: 'QUEUED',
      progressPercent: 0,
      // attempt 语义是「已被领取的次数」，必须从 0 起：
      // 若从 1 起，第一次 claim 就把它加到 2，`attempt >= MAX_ATTEMPTS` 立即成立，
      // 崩溃回收会直接落 FAILED —— 等于**一次重试都不会发生**。
      attempt: 0,
    } as any);
  }

  /** 该会话尚未走到终态的任务（存在则说明有人在跑或即将跑） */
  async findActive(sessionId: string): Promise<AnalysisTask | null> {
    return this.taskModel.findOne({
      where: { sessionId, state: { [Op.in]: ['QUEUED', 'RUNNING'] } },
      order: [['created_at', 'DESC']],
    });
  }

  /** 该会话最近一次任务（不论终态），用于展示失败原因 */
  async findLatest(sessionId: string): Promise<AnalysisTask | null> {
    return this.taskModel.findOne({
      where: { sessionId },
      order: [['created_at', 'DESC']],
    });
  }

  // ── 领取 / 续租 ─────────────────────────────────────────────

  /**
   * 领取一个 QUEUED 任务。单语句 CAS，不开事务、不 `FOR UPDATE`：
   *
   *   UPDATE ... SET state='RUNNING', ... WHERE id=? AND state='QUEUED' AND locked_at IS NULL
   *
   * 竞争失败时影响行数为 0，调用方换下一个候选即可。`attempt` 只由竞争的
   * 赢家写入，所以 `task.attempt + 1` 不会写入陈旧值。
   */
  async claim(task: AnalysisTask): Promise<boolean> {
    const now = new Date();
    const [affected] = await this.taskModel.update(
      {
        state: 'RUNNING',
        lockedBy: this.workerId,
        lockedAt: now,
        // 领取即打一次心跳，避免刚领取就被判僵死
        heartbeatAt: now,
        startedAt: task.startedAt ?? now,
        attempt: task.attempt + 1,
      } as any,
      { where: { id: task.id, state: 'QUEUED', lockedAt: null } },
    );
    return affected === 1;
  }

  /** 候选任务：最早的若干个 QUEUED */
  async listQueued(limit: number): Promise<AnalysisTask[]> {
    return this.taskModel.findAll({
      where: { state: 'QUEUED' },
      order: [['created_at', 'ASC']],
      limit,
    });
  }

  /** 续租。失败只记日志，绝不影响正在跑的分析。 */
  async heartbeat(taskId: number): Promise<void> {
    try {
      await this.taskModel.update({ heartbeatAt: new Date() } as any, {
        where: { id: taskId, state: 'RUNNING' },
      });
    } catch (err: any) {
      this.logger.warn(
        `[heartbeat] 续租失败 id=${taskId}: ${err?.message ?? err}`,
      );
    }
  }

  // ── 进度（旁路，失败不影响管道）────────────────────────────

  /**
   * 写进度。**调用方必须容错**：进度是可有可无的信息，不能成为失败源 ——
   * 一次 DB 抖动若抛出 `for await`，整条 LLM 流会被背压拖死。
   */
  async reportProgress(
    taskId: number,
    stage: string | null,
    percent: number | null,
  ): Promise<void> {
    await this.taskModel.update(
      { progressStage: stage, progressPercent: percent } as any,
      { where: { id: taskId, state: 'RUNNING' } },
    );
  }

  // ── 终态（全部带状态守卫）──────────────────────────────────

  /** 成功。返回是否真的由本调用完成跃迁（false 说明已被 cancel/reap 抢先） */
  async markSucceeded(taskId: number): Promise<boolean> {
    return this.toTerminal(taskId, 'SUCCEEDED');
  }

  async markFailed(taskId: number, reason: string): Promise<boolean> {
    return this.toTerminal(taskId, 'FAILED', reason);
  }

  /** 取消。QUEUED 与 RUNNING 都走这里（守卫不同） */
  async markCanceled(taskId: number): Promise<boolean> {
    return this.toTerminal(taskId, 'CANCELED', '已取消');
  }

  private async toTerminal(
    taskId: number,
    state: 'SUCCEEDED' | 'FAILED' | 'CANCELED',
    errorMessage?: string,
  ): Promise<boolean> {
    const [affected] = await this.taskModel.update(
      {
        state,
        finishedAt: new Date(),
        progressPercent: state === 'SUCCEEDED' ? 100 : undefined,
        errorMessage: errorMessage ?? null,
        lockedBy: null,
        lockedAt: null,
        heartbeatAt: null,
      } as any,
      { where: { id: taskId, state: { [Op.in]: ['QUEUED', 'RUNNING'] } } },
    );
    return affected === 1;
  }

  // ── 取消（按状态分派，防 reap 竞态）─────────────────────────

  /**
   * 取消会话当前的任务。
   *
   * 分派必须按**读到的状态**走，否则会撞上 reap 的「RUNNING → QUEUED」重排：
   *  - QUEUED：直接 CAS 翻成 CANCELED。`claim` 的 `WHERE state='QUEUED'`
   *    因此命中 0 行，worker 天然拿不到它 —— 无论重排发生在请求之前还是之后，
   *    最终都会落到 CANCELED。
   *  - RUNNING：由调用方经 registry 中断运行；这里只负责改状态。
   *  - 已终态：no-op。
   *
   * @returns 是否需要调用方去中断正在跑的运行（即读到的是 RUNNING）
   */
  async cancelBySession(
    sessionId: string,
  ): Promise<{ canceled: boolean; wasRunning: boolean }> {
    const task = await this.findActive(sessionId);
    if (!task) return { canceled: false, wasRunning: false };

    const wasRunning = task.state === 'RUNNING';
    const ok = await this.markCanceled(task.id);
    return { canceled: ok, wasRunning };
  }

  // ── 僵死回收 ────────────────────────────────────────────────

  /**
   * 回收僵死任务：RUNNING 但心跳过期。
   *
   * 对账规则（关键）：回收前先看会话状态 —— 若已经是 COMPLETED/FAILED，
   * 说明进程死在「管道写完会话状态」与「镜像任务行」之间，此时**只镜像、
   * 不重跑**，避免重复向厂商付费。
   *
   * @param sessionStatusOf 由调用方注入的会话状态查询（保持本服务对 AnalysisService 无依赖）
   */
  async reapStale(
    sessionStatusOf: (sessionId: string) => Promise<string | null>,
  ): Promise<{ requeued: number; failed: number; reconciled: number }> {
    const cutoff = new Date(Date.now() - RUNNING_STALE_MS);
    const stale = await this.taskModel.findAll({
      where: { state: 'RUNNING', heartbeatAt: { [Op.lt]: cutoff } },
    });

    let requeued = 0;
    let failed = 0;
    let reconciled = 0;

    for (const task of stale) {
      const sessionStatus = await sessionStatusOf(task.sessionId);

      // 管道已落终态、只差任务行 → 只镜像，绝不重跑
      if (sessionStatus === 'COMPLETED' || sessionStatus === 'FAILED') {
        const mirrored = sessionStatus === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED';
        // 用带守卫的更新，避免覆盖并发的 cancel
        const [n] = await this.taskModel.update(
          {
            state: mirrored,
            finishedAt: new Date(),
            lockedBy: null,
            lockedAt: null,
            heartbeatAt: null,
          } as any,
          { where: { id: task.id, state: 'RUNNING' } },
        );
        if (n === 1) reconciled++;
        continue;
      }

      if (task.attempt >= MAX_ATTEMPTS) {
        await this.markFailed(task.id, '服务中断，请重试');
        failed++;
        continue;
      }

      // 重新排队：独占翻转（语句本身清空心跳列，因此并发的第二个回收者
      // 重算 WHERE 时命中 0 行 —— 互斥就是从这里来的）
      const [n] = await this.taskModel.update(
        {
          state: 'QUEUED',
          lockedBy: null,
          lockedAt: null,
          heartbeatAt: null,
          progressStage: null,
          progressPercent: 0,
        } as any,
        {
          where: {
            id: task.id,
            state: 'RUNNING',
            heartbeatAt: { [Op.lt]: cutoff },
          },
        },
      );
      if (n === 1) requeued++;
    }

    if (requeued || failed || reconciled) {
      this.logger.warn(
        `[reap] 僵死任务回收 requeued=${requeued} failed=${failed} reconciled=${reconciled}`,
      );
    }
    return { requeued, failed, reconciled };
  }

  /** 排队超时：worker 长期不排空时避免会话永远卡住 */
  async cancelTimedOutQueued(): Promise<number> {
    const cutoff = new Date(Date.now() - QUEUED_TIMEOUT_MS);
    const [n] = await this.taskModel.update(
      {
        state: 'CANCELED',
        finishedAt: new Date(),
        errorMessage: '排队超时，请重试',
      } as any,
      { where: { state: 'QUEUED', created_at: { [Op.lt]: cutoff } } },
    );
    if (n > 0)
      this.logger.warn(`[cleanup] ${n} 个排队任务超时，已置为 CANCELED`);
    return n;
  }

  /** 正在跑（心跳新鲜）的会话 id —— 供兜底清理排除，避免误杀长跑 */
  async listRunningSessionIds(): Promise<string[]> {
    const cutoff = new Date(Date.now() - RUNNING_STALE_MS);
    const rows = await this.taskModel.findAll({
      where: { state: 'RUNNING', heartbeatAt: { [Op.gte]: cutoff } },
      attributes: ['sessionId'],
    });
    return rows.map((r) => r.sessionId);
  }
}
