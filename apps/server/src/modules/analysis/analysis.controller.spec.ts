import { AnalysisController } from './analysis.controller';
import { AnalysisRunRegistry } from './analysis-run.registry';

/**
 * `/stream` 的回归护栏。
 *
 * 这里最要紧的一条是「运行结束前不许关闭连接」—— 阶段一重构把
 * `for await (execute())` 换成 `registry.subscribe()` 之后，handler 里
 * 一度没有任何 await 撑着，`finally` 里的 `res.end()` 会立刻执行，
 * 连接一关，后续事件全部写不出去。当时整个文件的测试覆盖是零。
 */
describe('AnalysisController /stream', () => {
  let registry: AnalysisRunRegistry;
  let controller: AnalysisController;
  let service: any;
  let taskService: any;
  let worker: any;
  let closeHandlers: Array<() => void>;

  const user = { id: 1 } as any;

  /** 够用的 Response 替身：safeWrite 会读 writableEnded / destroyed */
  const makeRes = () => {
    const chunks: string[] = [];
    const res: any = {
      chunks,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      end: jest.fn(),
      write: jest.fn((c: string) => {
        chunks.push(c);
        return true;
      }),
      writableEnded: false,
      destroyed: false,
    };
    return res;
  };

  const makeReq = () => ({
    on: jest.fn((evt: string, cb: () => void) => {
      if (evt === 'close') closeHandlers.push(cb);
    }),
  });

  /** 让 handler 把已排队的微任务跑完（推它穿过那些 await） */
  const settle = () => new Promise((r) => setImmediate(r));

  const bodyOf = (res: any) => res.chunks.join('');

  beforeEach(() => {
    registry = new AnalysisRunRegistry();
    closeHandlers = [];

    service = {
      getSession: jest.fn().mockResolvedValue({ status: 'ANALYZING' }),
      getDetail: jest.fn(),
      updateStatus: jest.fn(),
    };
    taskService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      findLatest: jest.fn().mockResolvedValue({ state: 'RUNNING' }),
      cancelBySession: jest.fn(),
    };
    worker = {
      wake: jest.fn(),
      abortRun: jest.fn(),
    };

    controller = new AnalysisController(service, taskService, worker, registry);
  });

  describe('连接生命周期', () => {
    it('运行结束前不关闭连接，期间的帧照常写出（回归护栏）', async () => {
      const res = makeRes();
      const req = makeReq();

      let settled = false;
      const done = controller
        .streamAnalysis(user, 's1', undefined, res as any, req as any)
        .then(() => {
          settled = true;
        });

      await settle();

      // 少那层 await 的话，这里 handler 已经走完 finally、连接被关掉了
      expect(settled).toBe(false);
      expect(res.end).not.toHaveBeenCalled();

      // 运行产出事件 —— 必须能写到这条连接上
      registry.start('s1');
      registry.publish('s1', { type: 'thinking', delta: 'hi' });
      expect(bodyOf(res)).toContain('event: thinking');
      expect(settled).toBe(false);

      // 运行结束 → handler 收尾
      registry.complete('s1');
      await done;
      expect(res.end).toHaveBeenCalled();
    });

    it('收尾时补一个 done 帧，客户端不必靠断连兜底判死', async () => {
      const res = makeRes();
      const req = makeReq();
      const done = controller.streamAnalysis(
        user,
        's1',
        undefined,
        res as any,
        req as any,
      );

      await settle();
      registry.start('s1');
      registry.complete('s1');
      await done;

      expect(bodyOf(res)).toContain('event: done');
    });

    it('客户端断开后立即收尾，不再死等运行结束', async () => {
      const res = makeRes();
      const req = makeReq();
      const done = controller.streamAnalysis(
        user,
        's1',
        undefined,
        res as any,
        req as any,
      );

      await settle();
      expect(registry.count()).toBe(1); // 订阅已登记（按需创建的空壳）

      closeHandlers.forEach((h) => h());
      await done;

      expect(res.end).toHaveBeenCalled();
      // 空壳条目（没人听 + 没启动 + 没事件）应被回收
      expect(registry.count()).toBe(0);
    });
  });

  describe('游标', () => {
    it('每帧前置 id: 行，与事件的 seq 一致', async () => {
      registry.start('s1');
      registry.publish('s1', { type: 'thinking', delta: 'a' });
      registry.publish('s1', { type: 'thinking', delta: 'b' });

      const res = makeRes();
      const done = controller.streamAnalysis(
        user,
        's1',
        undefined,
        res as any,
        makeReq() as any,
      );
      await settle();
      registry.complete('s1');
      await done;

      const body = bodyOf(res);
      expect(body).toContain('id: 1\nevent: thinking\ndata: a');
      expect(body).toContain('id: 2\nevent: thinking\ndata: b');
    });

    it('?after= 只回放该序号之后的事件（重连不重复）', async () => {
      registry.start('s1');
      for (const d of ['a', 'b', 'c']) {
        registry.publish('s1', { type: 'thinking', delta: d });
      }

      const res = makeRes();
      const done = controller.streamAnalysis(
        user,
        's1',
        '2',
        res as any,
        makeReq() as any,
      );
      await settle();
      registry.complete('s1');
      await done;

      const body = bodyOf(res);
      expect(body).not.toContain('data: a');
      expect(body).not.toContain('data: b');
      expect(body).toContain('data: c');
    });

    it('游标掉出保留窗口时先发 truncated 帧（带可续传位置）', async () => {
      registry.start('s1');
      for (let i = 0; i < 2005; i++) {
        registry.publish('s1', { type: 'thinking', delta: `t${i}` });
      }

      const res = makeRes();
      const done = controller.streamAnalysis(
        user,
        's1',
        '1',
        res as any,
        makeReq() as any,
      );
      await settle();
      registry.complete('s1');
      await done;

      const body = bodyOf(res);
      expect(body).toContain('event: truncated');
      expect(body).toContain('"firstSeq":6');
      // 必须在 replay 之前发，客户端才知道要先丢掉残缺缓冲
      expect(body.indexOf('event: truncated')).toBeLessThan(
        body.indexOf('event: thinking'),
      );
    });

    it('非法/缺省的 after 按 0 处理，不报错', async () => {
      registry.start('s1');
      registry.publish('s1', { type: 'thinking', delta: 'a' });

      const res = makeRes();
      const done = controller.streamAnalysis(
        user,
        's1',
        'not-a-number',
        res as any,
        makeReq() as any,
      );
      await settle();
      registry.complete('s1');
      await done;

      expect(bodyOf(res)).toContain('data: a');
    });
  });

  describe('终态与兜底', () => {
    it('终态会话直接补发结果，不订阅运行', async () => {
      service.getSession.mockResolvedValue({ status: 'COMPLETED' });
      service.getDetail.mockResolvedValue({
        charts: [{ id: '1', type: 'bar', title: 't', data: [] }],
        tables: [],
        result: {
          summary: 's',
          content: 'c',
          charts: [],
          tables: [],
          insights: [],
        },
      });

      const res = makeRes();
      await controller.streamAnalysis(
        user,
        's1',
        undefined,
        res as any,
        makeReq() as any,
      );

      expect(bodyOf(res)).toContain('event: complete');
      expect(res.end).toHaveBeenCalled();
      expect(registry.count()).toBe(0);
    });

    it('任务已终态且没有运行时不干等，补 error 帧后收尾', async () => {
      taskService.findLatest.mockResolvedValue({
        state: 'FAILED',
        errorMessage: '分析失败，请重试',
      });

      const res = makeRes();
      // 若少了那个早返回，这里会挂到 30 分钟超时
      await controller.streamAnalysis(
        user,
        's1',
        undefined,
        res as any,
        makeReq() as any,
      );

      expect(bodyOf(res)).toContain('event: error');
      expect(bodyOf(res)).toContain('分析失败，请重试');
      expect(res.end).toHaveBeenCalled();
    });

    it('取不到任务记录时给出明确错误而不是静默挂着', async () => {
      taskService.findLatest.mockResolvedValue(null);

      const res = makeRes();
      await controller.streamAnalysis(
        user,
        's1',
        undefined,
        res as any,
        makeReq() as any,
      );

      expect(bodyOf(res)).toContain('分析任务不存在');
      expect(res.end).toHaveBeenCalled();
    });
  });
});
