import { Injectable, Logger } from '@nestjs/common';
import type { AnalysisEvent } from '@repo/types';

/** 单个运行的缓冲上限（防止超长输出把内存撑爆；超出丢最旧的） */
const MAX_BUFFERED_EVENTS = 2000;

/** 运行结束后保留缓冲的宽限期，便于「刚结束就订阅」也能拿到完整结果 */
const RETENTION_MS = 5 * 60 * 1000;

export interface BufferedEvent {
  seq: number;
  event: AnalysisEvent;
}

export interface RunSubscription {
  /** 订阅前已产出、且在游标之后的事件（`seq > fromSeq`） */
  replay: BufferedEvent[];
  /** 缓冲中最旧的 seq；一条事件都没有时为 null */
  firstSeq: number | null;
  /** 缓冲中最新的 seq；一条事件都没有时为 null */
  lastSeq: number | null;
  /**
   * 客户端游标已掉出缓冲窗口 —— 中间那段事件被永久丢弃了。
   *
   * 缓冲是 FIFO 截断的，因此 `firstSeq` 只保证「最旧的还在的」，
   * 不保证等于 1。调用方不能把 `replay` 当成一条连续、完整的流。
   */
  truncated: boolean;
  /** 这次运行是否真的被 worker 启动过（区别于「只是有人订阅了」） */
  started: boolean;
  /** 运行结束时 resolve（`complete()` / `abort()`）；订阅时早已结束则立即 resolve */
  done: Promise<void>;
  unsubscribe: () => void;
}

interface LiveRun {
  sessionId: string;
  /** 单调递增（截断不回卷），供游标重放使用 */
  seq: number;
  events: BufferedEvent[];
  subscribers: Set<(e: AnalysisEvent, seq: number) => void>;
  /** worker 是否启动过这次运行 —— 空壳回收的判据之一 */
  started: boolean;
  done: boolean;
  doneResolvers: Array<() => void>;
  evictTimer?: NodeJS.Timeout;
}

/**
 * 进程内的「正在跑的分析」注册表：worker 往里 publish，订阅者从里面读。
 *
 * 这是把 `for await (execute())` 从「一个 HTTP 响应」解耦出来的关键 ——
 * 管道只对 sink 产出，谁来听、有几个听众都与它无关。
 *
 * 游标语义：`seq` 从 1 开始、单调递增、截断后**不回卷**，所以
 * `seq !== events.length`。客户端带着自己的游标重连时，
 * `subscribe(id, cb, { fromSeq })` 只回放 `seq > fromSeq` 的部分。
 *
 * 局限（已知并接受）：缓冲是**进程内**的 —— 服务重启后重启的运行没有历史分片，
 * 客户端只能看到进度从 0 重来。在途的 LLM 流本来也无法跨重启恢复。
 */
@Injectable()
export class AnalysisRunRegistry {
  private readonly logger = new Logger(AnalysisRunRegistry.name);
  private readonly runs = new Map<string, LiveRun>();

  /** worker 启动一次运行时登记 */
  start(sessionId: string): void {
    const existing = this.runs.get(sessionId);

    // 原地重置，不要 runs.set() 整个换对象：换对象会让已订阅者手里那份
    // unsubscribe 闭包指向旧对象，变成删不掉的孤儿订阅。
    if (existing) {
      this.clearTimer(sessionId);
      existing.seq = 0;
      existing.events = [];
      existing.started = true;
      existing.done = false;
      // doneResolvers **不能清**：先订阅、后 start 是常态（wake 是异步的），
      // 清掉就会让那些订阅者手里已经发出的 done promise 永远悬着。
      // 正常路径下这个数组本来就是空的 —— complete() 在 resolve 时已清过。
      return;
    }

    this.runs.set(sessionId, this.createRun(sessionId, true));
  }

  /**
   * 订阅某个会话的实时事件。
   *
   * 运行不存在时会**按需创建**条目 —— worker 是 worker.wake() 异步拉起的，
   * 「先订阅、后 start」是常态而非边缘情况；不创建的话调用方只能拿到一个
   * 永久惰性的空订阅，客户端从此只收得到心跳。
   */
  subscribe(
    sessionId: string,
    onEvent: (e: AnalysisEvent, seq: number) => void,
    opts: { fromSeq?: number } = {},
  ): RunSubscription {
    const fromSeq = Math.max(0, opts.fromSeq ?? 0);

    let run = this.runs.get(sessionId);
    if (!run) {
      run = this.createRun(sessionId, false);
      this.runs.set(sessionId, run);
    }

    const firstSeq = run.events.length > 0 ? run.events[0].seq : null;
    const lastSeq =
      run.events.length > 0 ? run.events[run.events.length - 1].seq : null;

    // fromSeq 落在保留窗口之前 ⇒ 中间有洞。`fromSeq === 0` 表示客户端
    // 不要增量、全量拉取，这种情况不算越界。
    const truncated =
      fromSeq > 0 && firstSeq !== null && fromSeq < firstSeq - 1;

    const replay =
      fromSeq > 0
        ? run.events.filter((e) => e.seq > fromSeq)
        : run.events.slice();

    run.subscribers.add(onEvent);

    const active = run;
    const done = active.done
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          active.doneResolvers.push(resolve);
        });

    return {
      replay,
      firstSeq,
      lastSeq,
      truncated,
      started: active.started,
      done,
      unsubscribe: () => {
        // 查一次 Map 而不是用闭包里的 active：条目可能在期间被回收重建过。
        const current = this.runs.get(sessionId);
        if (!current) return;
        current.subscribers.delete(onEvent);
        this.collectIfEmpty(sessionId, current);
      },
    };
  }

  /** 是否有活跃运行（含刚结束但仍在保留期内的） */
  has(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  /** 供诊断与测试观察注册表规模 */
  count(): number {
    return this.runs.size;
  }

  /** worker 产出一个事件 */
  publish(sessionId: string, event: AnalysisEvent): void {
    const run = this.runs.get(sessionId);
    if (!run) return;

    run.seq += 1;
    const item: BufferedEvent = { seq: run.seq, event };

    run.events.push(item);
    if (run.events.length > MAX_BUFFERED_EVENTS) {
      run.events.splice(0, run.events.length - MAX_BUFFERED_EVENTS);
    }

    for (const sub of run.subscribers) {
      try {
        sub(event, item.seq);
      } catch (err: any) {
        // 单个订阅者出错不能影响其它订阅者与管道
        this.logger.warn(`[registry] 订阅者回调异常: ${err?.message ?? err}`);
      }
    }
  }

  /** 运行结束：通知订阅者、保留缓冲一段时间后驱逐 */
  complete(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (!run) return;
    run.done = true;
    run.subscribers.clear();

    // 唤醒所有在 await done 的订阅者，让它们能正常收尾而不是干等到超时
    const resolvers = run.doneResolvers;
    run.doneResolvers = [];
    for (const resolve of resolvers) {
      try {
        resolve();
      } catch {
        // resolve 本身不该抛，兜住以防万一
      }
    }

    this.clearTimer(sessionId);
    const timer = setTimeout(() => this.runs.delete(sessionId), RETENTION_MS);
    // 不拖住进程退出
    timer.unref?.();
    run.evictTimer = timer;
  }

  /** 运行被取消或异常终止 */
  abort(sessionId: string): void {
    this.complete(sessionId);
  }

  private createRun(sessionId: string, started: boolean): LiveRun {
    return {
      sessionId,
      seq: 0,
      events: [],
      subscribers: new Set(),
      started,
      done: false,
      doneResolvers: [],
    };
  }

  /**
   * 回收空壳条目。
   *
   * 按需创建带来一个泄漏面：「进详情页 → 订阅 → 退出」，而 worker 始终没启动
   * 这次运行（任务卡在 QUEUED），条目就会永久留在 Map 里。只有
   * **没人听 + 从没启动过 + 一条事件都没缓冲**三者同时成立，才能确定它是空的。
   *
   * 已启动的运行不在这里回收 —— 交给 complete() 的保留期定时器。
   */
  private collectIfEmpty(sessionId: string, run: LiveRun): void {
    if (run.subscribers.size > 0 || run.started || run.events.length > 0)
      return;
    this.clearTimer(sessionId);
    this.runs.delete(sessionId);
  }

  private clearTimer(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run?.evictTimer) clearTimeout(run.evictTimer);
  }
}
