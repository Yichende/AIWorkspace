import { AnalysisRunRegistry } from './analysis-run.registry';
import type { AnalysisEvent } from '@repo/types';

const thinking = (delta: string): AnalysisEvent => ({
  type: 'thinking',
  delta,
});

/** 缓冲上限，与实现里保持一致（测试要靠它制造截断） */
const MAX_BUFFERED_EVENTS = 2000;

describe('AnalysisRunRegistry', () => {
  let registry: AnalysisRunRegistry;

  beforeEach(() => {
    registry = new AnalysisRunRegistry();
  });

  describe('seq 单调递增', () => {
    it('从 1 开始，逐条 +1', () => {
      registry.start('s1');
      registry.publish('s1', thinking('a'));
      registry.publish('s1', thinking('b'));

      const sub = registry.subscribe('s1', () => {});
      expect(sub.replay.map((e) => e.seq)).toEqual([1, 2]);
    });

    it('start() 把 seq 重置回 0（重排意味着 seq 空间重来）', () => {
      registry.start('s1');
      registry.publish('s1', thinking('a'));

      registry.start('s1');
      registry.publish('s1', thinking('b'));

      const sub = registry.subscribe('s1', () => {});
      expect(sub.replay.map((e) => e.seq)).toEqual([1]);
    });
  });

  describe('游标重放', () => {
    it('不带游标时全量回放', () => {
      registry.start('s1');
      for (const d of ['a', 'b', 'c']) registry.publish('s1', thinking(d));

      const sub = registry.subscribe('s1', () => {});
      expect(sub.replay).toHaveLength(3);
      expect(sub.truncated).toBe(false);
    });

    it('fromSeq 收窄为 seq > fromSeq', () => {
      registry.start('s1');
      for (const d of ['a', 'b', 'c']) registry.publish('s1', thinking(d));

      const sub = registry.subscribe('s1', () => {}, { fromSeq: 1 });
      expect(sub.replay.map((e) => e.seq)).toEqual([2, 3]);
      expect(sub.truncated).toBe(false);
    });

    it('fromSeq 等于最新 seq 时回放为空（重连不重复）', () => {
      registry.start('s1');
      for (const d of ['a', 'b']) registry.publish('s1', thinking(d));

      const sub = registry.subscribe('s1', () => {}, { fromSeq: 2 });
      expect(sub.replay).toEqual([]);
      expect(sub.truncated).toBe(false);
    });

    it('暴露 firstSeq / lastSeq', () => {
      registry.start('s1');
      expect(registry.subscribe('s1', () => {}).firstSeq).toBeNull();

      registry.publish('s1', thinking('a'));
      registry.publish('s1', thinking('b'));
      const sub = registry.subscribe('s1', () => {});
      expect(sub.firstSeq).toBe(1);
      expect(sub.lastSeq).toBe(2);
    });
  });

  describe('游标越界（truncated）', () => {
    it('游标掉出保留窗口时置位，且不能当成连续流', () => {
      registry.start('s1');
      for (let i = 0; i < MAX_BUFFERED_EVENTS + 5; i++) {
        registry.publish('s1', thinking(`t${i}`));
      }

      // 最旧的已被挤掉：此时缓冲里最旧的是 seq 6
      const sub = registry.subscribe('s1', () => {}, { fromSeq: 1 });
      expect(sub.firstSeq).toBe(6);
      expect(sub.truncated).toBe(true);
      expect(sub.replay.every((e) => e.seq > 1)).toBe(true);
    });

    it('fromSeq=0 表示要全量，不算越界', () => {
      registry.start('s1');
      for (let i = 0; i < MAX_BUFFERED_EVENTS + 5; i++) {
        registry.publish('s1', thinking(`t${i}`));
      }

      const sub = registry.subscribe('s1', () => {});
      expect(sub.truncated).toBe(false);
    });

    it('游标刚好落在保留窗口起点上时不算越界', () => {
      registry.start('s1');
      for (let i = 0; i < MAX_BUFFERED_EVENTS + 5; i++) {
        registry.publish('s1', thinking(`t${i}`));
      }

      // 最旧的是 6，游标 5 ⇒ 下一条正好接得上
      const sub = registry.subscribe('s1', () => {}, { fromSeq: 5 });
      expect(sub.firstSeq).toBe(6);
      expect(sub.truncated).toBe(false);
    });
  });

  describe('done 信号', () => {
    it('complete() 会让 await done 的订阅者被唤醒', async () => {
      registry.start('s1');
      const sub = registry.subscribe('s1', () => {});

      let resolved = false;
      const waiting = sub.done.then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);
      registry.complete('s1');
      await waiting;
      expect(resolved).toBe(true);
    });

    it('abort() 同样唤醒', async () => {
      registry.start('s1');
      const sub = registry.subscribe('s1', () => {});
      registry.abort('s1');
      await expect(sub.done).resolves.toBeUndefined();
    });

    it('先订阅、后 start，done 仍会在结束时 resolve（不能被 start 重置掉）', async () => {
      const sub = registry.subscribe('s1', () => {});
      registry.start('s1');

      let resolved = false;
      const waiting = sub.done.then(() => {
        resolved = true;
      });

      registry.complete('s1');
      await waiting;
      expect(resolved).toBe(true);
    });

    it('订阅时运行已结束则立即 resolve', async () => {
      registry.start('s1');
      registry.publish('s1', thinking('a'));
      registry.complete('s1');

      // 保留期内条目还在
      const sub = registry.subscribe('s1', () => {});
      await expect(sub.done).resolves.toBeUndefined();
      // 缓冲仍可回放：刚好错过的客户端拿得到完整结果
      expect(sub.replay).toHaveLength(1);
    });
  });

  describe('订阅早于启动（worker.wake 是异步的）', () => {
    it('先订阅后 start 仍能收到事件，而不是一条惰性空订阅', () => {
      const seen: Array<[string, number]> = [];
      const sub = registry.subscribe('s1', (e, seq) => {
        seen.push([(e as { delta: string }).delta, seq]);
      });

      expect(sub.started).toBe(false);
      expect(sub.replay).toEqual([]);

      registry.start('s1');
      registry.publish('s1', thinking('a'));

      expect(seen).toEqual([['a', 1]]);
    });

    it('start() 原地重置，不会让已有订阅变成孤儿', () => {
      const fn = jest.fn();
      registry.subscribe('s1', fn);

      registry.start('s1');
      registry.publish('s1', thinking('a'));

      expect(fn).toHaveBeenCalledTimes(1);

      // 退订必须真的生效（否则闭包指向的是被替换掉的旧对象）
      registry.subscribe('s1', () => {}); // 保持另一个订阅者，避免空壳被回收
      expect(registry.count()).toBe(1);
    });

    it('已启动的运行在 unsubscribe 后不被回收', () => {
      registry.start('s1');
      registry.publish('s1', thinking('a'));
      const sub = registry.subscribe('s1', () => {});

      sub.unsubscribe();

      expect(registry.count()).toBe(1);
    });
  });

  describe('空壳条目回收', () => {
    it('没人听 + 没启动 + 没事件 ⇒ 立即回收', () => {
      const sub = registry.subscribe('s1', () => {});
      expect(registry.count()).toBe(1);

      sub.unsubscribe();
      expect(registry.count()).toBe(0);
    });

    it('还有别的订阅者时不回收', () => {
      const a = registry.subscribe('s1', () => {});
      registry.subscribe('s1', () => {});

      a.unsubscribe();
      expect(registry.count()).toBe(1);
    });

    it('运行已启动时不回收（交给 complete 的保留期定时器）', () => {
      registry.start('s1');
      const sub = registry.subscribe('s1', () => {});

      sub.unsubscribe();
      expect(registry.count()).toBe(1);
    });

    it('有缓冲事件时不回收', () => {
      registry.start('s1');
      registry.publish('s1', thinking('a'));
      const sub = registry.subscribe('s1', () => {});

      sub.unsubscribe();
      expect(registry.count()).toBe(1);
    });
  });

  describe('健壮性', () => {
    it('单个订阅者回调抛错不影响其它订阅者与发布方', () => {
      registry.start('s1');
      const good = jest.fn();
      registry.subscribe('s1', () => {
        throw new Error('boom');
      });
      registry.subscribe('s1', good);

      expect(() => registry.publish('s1', thinking('a'))).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
    });

    it('对不存在的运行 publish 是 no-op', () => {
      expect(() => registry.publish('nope', thinking('a'))).not.toThrow();
      expect(registry.has('nope')).toBe(false);
    });

    it('重复 unsubscribe 不抛错', () => {
      const sub = registry.subscribe('s1', () => {});
      sub.unsubscribe();
      expect(() => sub.unsubscribe()).not.toThrow();
    });
  });
});
