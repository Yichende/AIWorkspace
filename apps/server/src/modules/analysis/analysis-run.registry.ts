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

interface LiveRun {
  sessionId: string;
  /** 单调递增，供阶段二的游标重放使用 */
  seq: number;
  events: BufferedEvent[];
  subscribers: Set<(e: AnalysisEvent, seq: number) => void>;
  done: boolean;
  evictTimer?: NodeJS.Timeout;
}

/**
 * 进程内的「正在跑的分析」注册表：worker 往里 publish，订阅者从里面读。
 *
 * 这是把 `for await (execute())` 从「一个 HTTP 响应」解耦出来的关键 ——
 * 管道只对 sink 产出，谁来听、有几个听众都与它无关。
 *
 * 形态刻意做成阶段二不用返工：`subscribe()` 已经返回 `replay`，
 * 阶段一只需取「全部已产出」，阶段二收窄为「seq > 客户端游标」。
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
    this.clearTimer(sessionId);
    this.runs.set(sessionId, {
      sessionId,
      seq: 0,
      events: [],
      subscribers: new Set(),
      done: false,
    });
  }

  /**
   * 订阅某个会话的实时事件。
   *
   * @returns `replay` 为订阅前已产出的事件；`unsubscribe` 由调用方在断开时调用
   */
  subscribe(
    sessionId: string,
    onEvent: (e: AnalysisEvent, seq: number) => void,
  ): { replay: BufferedEvent[]; unsubscribe: () => void } {
    const run = this.runs.get(sessionId);
    if (!run) {
      // 没有在跑的运行：可能是已完成/尚未开始，由调用方走 HTTP 层的既有路径
      return { replay: [], unsubscribe: () => {} };
    }

    // 先取快照再加入订阅者：这样不会漏事件，最多重复（由 seq 去重）
    const replay = run.events.slice();
    run.subscribers.add(onEvent);

    return {
      replay,
      unsubscribe: () => {
        run.subscribers.delete(onEvent);
      },
    };
  }

  /** 是否有活跃运行（含刚结束但仍在保留期内的） */
  has(sessionId: string): boolean {
    return this.runs.has(sessionId);
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

  private clearTimer(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run?.evictTimer) clearTimeout(run.evictTimer);
  }
}
