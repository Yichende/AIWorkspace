import { Op } from 'sequelize';
import { AnalysisTaskService, MAX_ATTEMPTS } from './analysis-task.service';

/**
 * 这些用例锁的是**状态机的不变量**：所有跃迁都必须是带状态守卫的 CAS。
 * 用 mock 模型直接断言 `where` 里出现了状态守卫 —— 守卫一旦丢了，
 * cancel / reap / 终态镜像就会互相覆盖。
 */
describe('AnalysisTaskService 状态机', () => {
  let taskModel: any;
  let service: AnalysisTaskService;

  const makeTask = (over: Record<string, any> = {}) => ({
    id: 1,
    sessionId: 's1',
    state: 'QUEUED',
    attempt: 1,
    startedAt: null,
    ...over,
  });

  beforeEach(() => {
    taskModel = {
      create: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue([1]),
    };
    service = new AnalysisTaskService(taskModel);
  });

  describe('enqueue 幂等', () => {
    it('已有未终态任务时直接返回它，不再创建', async () => {
      const existing = makeTask();
      taskModel.findOne.mockResolvedValue(existing);

      await expect(service.enqueue('s1')).resolves.toBe(existing);
      expect(taskModel.create).not.toHaveBeenCalled();
    });

    it('没有活跃任务时才创建 QUEUED', async () => {
      taskModel.findOne.mockResolvedValue(null);
      taskModel.create.mockResolvedValue(makeTask());

      await service.enqueue('s1');
      expect(taskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's1', state: 'QUEUED' }),
      );
    });
  });

  describe('claim（CAS）', () => {
    it('成功时把状态守卫写进 where', async () => {
      await expect(service.claim(makeTask() as any)).resolves.toBe(true);

      const [values, options] = taskModel.update.mock.calls[0];
      expect(values).toMatchObject({ state: 'RUNNING' });
      expect(options.where).toMatchObject({
        id: 1,
        state: 'QUEUED',
        lockedAt: null,
      });
    });

    it('影响行数为 0 时返回 false（竞争失败）', async () => {
      taskModel.update.mockResolvedValue([0]);
      await expect(service.claim(makeTask() as any)).resolves.toBe(false);
    });

    it('领取时 attempt 递增，并记下 startedAt', async () => {
      await service.claim(makeTask({ attempt: 1 }) as any);
      const [values] = taskModel.update.mock.calls[0];
      expect(values.attempt).toBe(2);
      expect(values.startedAt).toBeInstanceOf(Date);
    });

    it('已有 startedAt 时重排后再领取不会覆盖首次开始时间', async () => {
      const started = new Date('2026-01-01T00:00:00Z');
      await service.claim(makeTask({ startedAt: started }) as any);
      const [values] = taskModel.update.mock.calls[0];
      expect(values.startedAt).toBe(started);
    });
  });

  describe('attempt 计数语义（决定崩溃后是否真的会重跑）', () => {
    it('enqueue 创建时 attempt 从 0 起', async () => {
      taskModel.create.mockResolvedValue(makeTask());
      await service.enqueue('s1');
      expect(taskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 0 }),
      );
    });

    it('首次领取后 attempt=1，此时仍允许崩溃重跑', async () => {
      await service.claim(makeTask({ attempt: 0 }) as any);
      const [values] = taskModel.update.mock.calls[0];
      expect(values.attempt).toBe(1);
      // 回收判定用的是「领取次数 >= MAX_ATTEMPTS」——首次执行后必须还没到上限
      expect(values.attempt).toBeLessThan(MAX_ATTEMPTS);
    });

    it('重跑一次后 attempt=2 达到上限（正好重试 1 次）', async () => {
      await service.claim(makeTask({ attempt: 1 }) as any);
      const [values] = taskModel.update.mock.calls[0];
      expect(values.attempt).toBe(MAX_ATTEMPTS);
    });
  });

  describe('终态写入都带状态守卫', () => {
    it('markSucceeded 只对 QUEUED/RUNNING 生效（终态不可再被改写）', async () => {
      await service.markSucceeded(1);
      const [values, options] = taskModel.update.mock.calls[0];
      expect(values.state).toBe('SUCCEEDED');
      expect(options.where.state[Op.in]).toEqual(['QUEUED', 'RUNNING']);
    });

    it('markFailed 记录原因', async () => {
      await service.markFailed(1, '服务中断，请重试');
      const [values] = taskModel.update.mock.calls[0];
      expect(values.state).toBe('FAILED');
      expect(values.errorMessage).toBe('服务中断，请重试');
    });

    it('markCanceled 记录「已取消」', async () => {
      await service.markCanceled(1);
      const [values] = taskModel.update.mock.calls[0];
      expect(values.state).toBe('CANCELED');
      expect(values.errorMessage).toBe('已取消');
    });

    it('已被抢先跃迁时返回 false（不覆盖）', async () => {
      taskModel.update.mockResolvedValue([0]);
      await expect(service.markFailed(1, 'x')).resolves.toBe(false);
    });

    it('终态会清空租约与心跳', async () => {
      await service.markSucceeded(1);
      const [values] = taskModel.update.mock.calls[0];
      expect(values.lockedBy).toBeNull();
      expect(values.lockedAt).toBeNull();
      expect(values.heartbeatAt).toBeNull();
    });
  });

  describe('cancelBySession（防 reap 竞态）', () => {
    it('读到 QUEUED 时直接翻成 CANCELED，不需要中断运行', async () => {
      taskModel.findOne.mockResolvedValue(makeTask({ state: 'QUEUED' }));

      const r = await service.cancelBySession('s1');

      expect(r).toEqual({ canceled: true, wasRunning: false });
      const [values] = taskModel.update.mock.calls[0];
      expect(values.state).toBe('CANCELED');
    });

    it('读到 RUNNING 时同样改状态，并告诉调用方去中断运行', async () => {
      taskModel.findOne.mockResolvedValue(makeTask({ state: 'RUNNING' }));

      const r = await service.cancelBySession('s1');

      expect(r).toEqual({ canceled: true, wasRunning: true });
    });

    it('没有活跃任务时是 no-op', async () => {
      taskModel.findOne.mockResolvedValue(null);
      await expect(service.cancelBySession('s1')).resolves.toEqual({
        canceled: false,
        wasRunning: false,
      });
      expect(taskModel.update).not.toHaveBeenCalled();
    });
  });

  describe('reapStale 对账规则', () => {
    const staleTask = makeTask({ id: 7, state: 'RUNNING', attempt: 1 });

    it('会话已 COMPLETED → 只镜像成 SUCCEEDED，不重跑', async () => {
      taskModel.findAll.mockResolvedValue([staleTask]);
      taskModel.update.mockResolvedValue([1]);

      const r = await service.reapStale(async () => 'COMPLETED');

      expect(r).toEqual({ requeued: 0, failed: 0, reconciled: 1 });
      const [values, options] = taskModel.update.mock.calls[0];
      expect(values.state).toBe('SUCCEEDED');
      expect(options.where.state).toBe('RUNNING');
    });

    it('会话已 FAILED → 镜像成 FAILED', async () => {
      taskModel.findAll.mockResolvedValue([staleTask]);
      taskModel.update.mockResolvedValue([1]);

      const r = await service.reapStale(async () => 'FAILED');
      expect(r.reconciled).toBe(1);
      expect(taskModel.update.mock.calls[0][0].state).toBe('FAILED');
    });

    it('会话非终态且 attempt 未超限 → 重新排队，清空租约与进度', async () => {
      taskModel.findAll.mockResolvedValue([staleTask]);
      taskModel.update.mockResolvedValue([1]);

      const r = await service.reapStale(async () => 'ANALYZING');

      expect(r).toEqual({ requeued: 1, failed: 0, reconciled: 0 });
      const [values, options] = taskModel.update.mock.calls[0];
      expect(values.state).toBe('QUEUED');
      expect(values.lockedAt).toBeNull();
      expect(values.heartbeatAt).toBeNull();
      expect(values.progressPercent).toBe(0);
      // 回收本身也要带心跳守卫 → 并发回收者互相排斥
      expect(options.where.state).toBe('RUNNING');
      expect(options.where.heartbeatAt).toBeDefined();
    });

    it(`attempt 达到上限（${MAX_ATTEMPTS}）→ 落 FAILED，不重复付费`, async () => {
      taskModel.findAll.mockResolvedValue([
        makeTask({ id: 7, state: 'RUNNING', attempt: MAX_ATTEMPTS }),
      ]);
      taskModel.update.mockResolvedValue([1]);

      const r = await service.reapStale(async () => 'ANALYZING');

      expect(r).toEqual({ requeued: 0, failed: 1, reconciled: 0 });
      const [values] = taskModel.update.mock.calls[0];
      expect(values.state).toBe('FAILED');
      expect(values.errorMessage).toBe('服务中断，请重试');
    });

    it('并发回收被抢先时不计入（影响 0 行）', async () => {
      taskModel.findAll.mockResolvedValue([staleTask]);
      taskModel.update.mockResolvedValue([0]);

      const r = await service.reapStale(async () => 'ANALYZING');
      expect(r).toEqual({ requeued: 0, failed: 0, reconciled: 0 });
    });
  });

  describe('listRunningSessionIds', () => {
    it('只返回心跳新鲜的运行中会话', async () => {
      taskModel.findAll.mockResolvedValue([
        { sessionId: 'a' },
        { sessionId: 'b' },
      ]);
      await expect(service.listRunningSessionIds()).resolves.toEqual([
        'a',
        'b',
      ]);

      const [options] = taskModel.findAll.mock.calls[0];
      expect(options.where.state).toBe('RUNNING');
      expect(options.where.heartbeatAt).toBeDefined();
    });
  });

  describe('heartbeat', () => {
    it('续租失败只记日志，不向上抛（不能影响正在跑的分析）', async () => {
      taskModel.update.mockRejectedValue(new Error('db down'));
      await expect(service.heartbeat(1)).resolves.toBeUndefined();
    });
  });
});
