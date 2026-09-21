import { AnalysisCleanupService } from './analysis-cleanup.service';

const FIRST_DELAY_MS = 20_000;
const INTERVAL_MS = 60 * 60 * 1000;
const STALE_ANALYZING_MS = 60 * 60 * 1000;

describe('AnalysisCleanupService 定时调度', () => {
  let cleanupExpiredFiles: jest.Mock;
  let failStaleAnalyzingSessions: jest.Mock;
  let analysisService: {
    cleanupExpiredFiles: jest.Mock;
    failStaleAnalyzingSessions: jest.Mock;
  };
  let service: AnalysisCleanupService;

  beforeEach(() => {
    jest.useFakeTimers();
    cleanupExpiredFiles = jest.fn().mockResolvedValue(3);
    failStaleAnalyzingSessions = jest.fn().mockResolvedValue(0);
    analysisService = { cleanupExpiredFiles, failStaleAnalyzingSessions };
    service = new AnalysisCleanupService(analysisService as any);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('onModuleInit 后不立刻清理，20s 时首跑一次', async () => {
    service.onModuleInit();

    await jest.advanceTimersByTimeAsync(FIRST_DELAY_MS - 1);
    expect(cleanupExpiredFiles).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(cleanupExpiredFiles).toHaveBeenCalledTimes(1);
  });

  it('首跑之后每小时一轮', async () => {
    service.onModuleInit();

    await jest.advanceTimersByTimeAsync(FIRST_DELAY_MS);
    expect(cleanupExpiredFiles).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(cleanupExpiredFiles).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(cleanupExpiredFiles).toHaveBeenCalledTimes(3);
  });

  it('一轮里同时清理过期文件与僵死会话', async () => {
    cleanupExpiredFiles.mockResolvedValue(2);
    failStaleAnalyzingSessions.mockResolvedValue(5);

    await expect(service.runCleanup()).resolves.toEqual({
      filesRemoved: 2,
      sessionsFailed: 5,
    });
    expect(failStaleAnalyzingSessions).toHaveBeenCalledWith(STALE_ANALYZING_MS);
  });

  it('上一轮未结束时跳过本轮（单飞）', async () => {
    let resolveInflight: (n: number) => void = () => {};
    cleanupExpiredFiles.mockReturnValue(
      new Promise<number>((res) => {
        resolveInflight = res;
      }),
    );
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(FIRST_DELAY_MS); // 首跑停在未决的 promise 上

    // 一轮还在跑时再来一轮
    await expect(service.runCleanup()).resolves.toEqual({
      filesRemoved: 0,
      sessionsFailed: 0,
    });
    // 被跳过的一轮不应触发任何步骤
    expect(cleanupExpiredFiles).toHaveBeenCalledTimes(1);
    expect(failStaleAnalyzingSessions).not.toHaveBeenCalled();

    resolveInflight(5);
  });

  it('清理文件失败不阻断会话清理，且不冒泡', async () => {
    cleanupExpiredFiles.mockRejectedValue(new Error('db down'));
    failStaleAnalyzingSessions.mockResolvedValue(4);

    await expect(service.runCleanup()).resolves.toEqual({
      filesRemoved: 0,
      sessionsFailed: 4,
    });
  });

  it('会话清理失败不影响文件清理结果', async () => {
    cleanupExpiredFiles.mockResolvedValue(7);
    failStaleAnalyzingSessions.mockRejectedValue(new Error('db down'));

    await expect(service.runCleanup()).resolves.toEqual({
      filesRemoved: 7,
      sessionsFailed: 0,
    });
  });

  it('两个步骤都失败时返回全零，不抛错', async () => {
    cleanupExpiredFiles.mockRejectedValue(new Error('a'));
    failStaleAnalyzingSessions.mockRejectedValue(new Error('b'));

    await expect(service.runCleanup()).resolves.toEqual({
      filesRemoved: 0,
      sessionsFailed: 0,
    });
  });

  it('onModuleDestroy 后不再触发', async () => {
    service.onModuleInit();
    service.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(FIRST_DELAY_MS + INTERVAL_MS);
    expect(cleanupExpiredFiles).not.toHaveBeenCalled();
  });
});
