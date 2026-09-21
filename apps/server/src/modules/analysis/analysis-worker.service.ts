import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { AnalysisQueueService } from './analysis-queue.service';
import {
  AnalysisTaskService,
  HEARTBEAT_INTERVAL_MS,
} from './analysis-task.service';
import { AnalysisRunRegistry } from './analysis-run.registry';

/** 轮询间隔：作为唤醒信号丢失时的安全网 */
const POLL_INTERVAL_MS = 3_000;

/** 首跑延迟：轮询是走索引的廉价读，没理由让重启后的分析干等（对比 cleanup 的 20s） */
const POLL_FIRST_DELAY_MS = 1_500;

/** 僵死回收间隔 */
const REAP_INTERVAL_MS = 60_000;

/**
 * 同时执行的分析数上限。
 *
 * 一次运行占一个上游 socket，且在解析重构前会把整份行数组留在内存里
 * （10MB xlsx 会膨胀到几十 MB）。2 同时限住了**并发的同步 XLSX 解析**数量。
 * 原实现是「每请求一个」，即无上限。
 */
const MAX_CONCURRENT_TASKS = Number(process.env.ANALYSIS_MAX_CONCURRENCY ?? 2);

/**
 * 分析 worker：从 `analysis_tasks` 领取任务并在后台执行。
 *
 * 与旧实现的关键差别：管道的生命周期不再绑定到某个 HTTP 连接。
 * 客户端断开只是「少了一个听众」，任务照常跑完。
 */
@Injectable()
export class AnalysisWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisWorkerService.name);
  private pollTimer?: NodeJS.Timeout;
  private reapTimer?: NodeJS.Timeout;
  private readonly firstTimer?: NodeJS.Timeout;
  /** 每个运行一个 AbortController：cancel 与停机都经它中断上游 */
  private readonly running = new Map<string, AbortController>();
  /** 单飞：避免轮询与 wake 并发领取同一批任务 */
  private claiming = false;

  constructor(
    private readonly analysisService: AnalysisService,
    private readonly queue: AnalysisQueueService,
    private readonly tasks: AnalysisTaskService,
    private readonly registry: AnalysisRunRegistry,
  ) {}

  onModuleInit(): void {
    const first = setTimeout(() => {
      void this.tick();
    }, POLL_FIRST_DELAY_MS);
    first.unref?.();

    this.pollTimer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.pollTimer.unref?.();

    this.reapTimer = setInterval(() => void this.reap(), REAP_INTERVAL_MS);
    this.reapTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reapTimer) clearInterval(this.reapTimer);
    // 停机：中断在跑的运行。任务保持 RUNNING 的租约，由僵死回收重排
    // （进程正常退出时不应把用户的还在跑的分析判成失败）
    for (const ctl of this.running.values()) {
      try {
        ctl.abort();
      } catch {
        // ignore
      }
    }
  }

  /** 唤醒：入队与订阅时调用，避免白等一个轮询周期 */
  wake(): void {
    void this.tick();
  }

  /** 中断某个会话正在跑的运行（取消接口用） */
  abortRun(sessionId: string): boolean {
    const ctl = this.running.get(sessionId);
    if (!ctl) return false;
    ctl.abort();
    return true;
  }

  // ── 轮询 ────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.claiming) return;
    this.claiming = true;
    try {
      const free = MAX_CONCURRENT_TASKS - this.running.size;
      if (free <= 0) return;

      const candidates = await this.tasks.listQueued(free);
      for (const candidate of candidates) {
        if (this.running.size >= MAX_CONCURRENT_TASKS) break;
        const claimed = await this.tasks.claim(candidate);
        if (!claimed) continue; // 竞争失败，换下一个
        // 领取后重新读一次，拿到 attempt 递增后的值
        void this.execute(candidate.sessionId);
      }
    } catch (err: any) {
      this.logger.error(`[worker] 轮询失败: ${err?.message ?? err}`);
    } finally {
      this.claiming = false;
    }
  }

  private async reap(): Promise<void> {
    try {
      await this.tasks.reapStale((sessionId) =>
        this.analysisService.getSessionStatus(sessionId),
      );
      await this.tasks.cancelTimedOutQueued();
    } catch (err: any) {
      this.logger.error(`[worker] 回收失败: ${err?.message ?? err}`);
    }
  }

  // ── 执行 ────────────────────────────────────────────────────

  private async execute(sessionId: string): Promise<void> {
    const ctl = new AbortController();
    this.running.set(sessionId, ctl);
    this.registry.start(sessionId);

    let heartbeatTimer: NodeJS.Timeout | undefined;
    try {
      const session = await this.analysisService.getSessionById(sessionId);
      if (!session) {
        this.logger.warn(`[worker] 会话不存在，跳过: ${sessionId}`);
        return;
      }

      const active = await this.tasks.findActive(sessionId);
      if (!active) return; // 已被取消

      heartbeatTimer = setInterval(
        () => void this.tasks.heartbeat(active.id),
        HEARTBEAT_INTERVAL_MS,
      );
      heartbeatTimer.unref?.();

      for await (const event of this.queue.execute(
        session.userId,
        sessionId,
        session.prompt ?? '',
        session.model,
        ctl.signal,
      )) {
        if (event.type === 'progress') {
          // 进度落库是旁路：DB 抖动只记日志，绝不拖慢或打断管道
          try {
            await this.tasks.reportProgress(
              active.id,
              event.stage,
              event.percent,
            );
          } catch (err: any) {
            this.logger.warn(`[progress] 写入失败: ${err?.message ?? err}`);
          }
        }
        this.registry.publish(sessionId, event);

        if (event.type === 'complete') {
          await this.tasks.markSucceeded(active.id);
        } else if (event.type === 'error') {
          await this.tasks.markFailed(active.id, event.message);
        }
      }

      // 管道静默返回（signal 被 abort）时：若任务仍是 RUNNING，说明是被取消
      const after = await this.tasks.findLatest(sessionId);
      if (after && after.id === active.id && after.state === 'RUNNING') {
        await this.tasks.markFailed(active.id, '分析中断，请重试');
      }
    } catch (err: any) {
      this.logger.error(
        `[worker] 执行失败 ${sessionId}: ${err?.message ?? err}`,
      );
      const active = await this.tasks.findActive(sessionId).catch(() => null);
      if (active) await this.tasks.markFailed(active.id, '分析失败，请重试');
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      this.running.delete(sessionId);
      this.registry.complete(sessionId);
    }
  }
}
