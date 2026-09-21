import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AnalysisService } from './analysis.service';

/** 启动后首跑延迟：给 Sequelize 建连/同步留时间，同时不阻塞启动 */
const CLEANUP_FIRST_DELAY_MS = 20_000;

/** 定时清理周期：文件过期粒度是 24h，每小时一轮足够 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * ANALYZING 超过该时长仍未走到终态即判定僵死。
 *
 * 正常分析 5–15 分钟，上游 idle 超时 90s，所以 1 小时既远超单次分析的合理
 * 上限（不会误杀进行中的任务），也远超「切后台再回来」的窗口（不会误判用户
 * 只是离开了片刻）。代价是僵死会话最长残留约 2 小时（阈值 + 一轮调度间隔）。
 */
const STALE_ANALYZING_MS = 60 * 60 * 1000;

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

  constructor(private readonly analysisService: AnalysisService) {}

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
        sessionsFailed: await this.runStep('清理僵死会话', () =>
          this.analysisService.failStaleAnalyzingSessions(STALE_ANALYZING_MS),
        ),
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
