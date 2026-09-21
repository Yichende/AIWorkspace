import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { AnalysisTaskService } from './analysis-task.service';

/** 启动后首跑延迟：给 Sequelize 建连/同步留时间，同时不阻塞启动 */
const CLEANUP_FIRST_DELAY_MS = 20_000;

/** 定时清理周期：文件过期粒度是 24h，每小时一轮足够 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 会话层兜底阈值：ANALYZING 且 `updated_at` 超过该时长仍未走到终态即判定僵死。
 *
 * ⚠️ 这条兜底**只针对没有任务行的会话**（历史遗留、或任务表未覆盖的路径）。
 * 有任务行的会话由任务心跳判定（`AnalysisTaskService.reapStale`，5 分钟粒度），
 * 因为 worker 运行期间 `analysis_sessions.updated_at` 不会变 —— 用 1 小时阈值
 * 会误杀合法的长跑。因此这里放宽到 2 小时，且**必须排除心跳新鲜的运行中会话**，
 * 否则同样会误杀。
 */
const STALE_ANALYZING_MS = 2 * 60 * 60 * 1000;

/** 一轮清理的结果 */
export interface CleanupResult {
  /** 删除的过期上传文件数 */
  filesRemoved: number;
  /** 判定僵死并置为 FAILED 的会话数 */
  sessionsFailed: number;
}

const EMPTY_RESULT: CleanupResult = { filesRemoved: 0, sessionsFailed: 0 };

/**
 * 定时清理：过期上传文件（expire_at = 上传时刻 + 24h）+ 僵死的 ANALYZING 会话。
 *
 * 不引入 @nestjs/schedule：需求只是「延迟首跑 + 每小时一轮」，
 * 零依赖的 timer 足够，且两个计时器都 .unref()（不拖住进程退出，
 * 因此也不需要 main.ts 的 enableShutdownHooks）。
 */
@Injectable()
export class AnalysisCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisCleanupService.name);
  private firstTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  /** 单飞：上一轮未结束时跳过本轮，避免重叠清理 */
  private running = false;

  constructor(
    private readonly analysisService: AnalysisService,
    private readonly taskService: AnalysisTaskService,
  ) {}

  onModuleInit(): void {
    this.firstTimer = setTimeout(
      () => void this.runCleanup(),
      CLEANUP_FIRST_DELAY_MS,
    );
    this.firstTimer.unref?.();

    this.intervalTimer = setInterval(
      () => void this.runCleanup(),
      CLEANUP_INTERVAL_MS,
    );
    this.intervalTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
  }

  /**
   * 执行一轮清理（测试可直接调用）。
   *
   * 两项任务互相独立，各自吞异常：清理文件失败不应连带跳过会话清理。
   */
  async runCleanup(): Promise<CleanupResult> {
    if (this.running) return { ...EMPTY_RESULT };
    this.running = true;
    try {
      return {
        filesRemoved: await this.runStep('清理过期文件', () =>
          this.analysisService.cleanupExpiredFiles(),
        ),
        sessionsFailed: await this.runStep('清理僵死会话', async () => {
          // 排除心跳新鲜的运行中会话：它们的 updated_at 不动，属正常现象
          const running = await this.taskService.listRunningSessionIds();
          return this.analysisService.failStaleAnalyzingSessions(
            STALE_ANALYZING_MS,
            running,
          );
        }),
      };
    } finally {
      this.running = false;
    }
  }

  /** 执行单个清理步骤：失败只记日志并返回 0，不向上抛 */
  private async runStep(
    label: string,
    fn: () => Promise<number>,
  ): Promise<number> {
    try {
      return await fn();
    } catch (err: any) {
      this.logger.error(`[cleanup] ${label}失败: ${err?.message ?? err}`);
      return 0;
    }
  }
}
