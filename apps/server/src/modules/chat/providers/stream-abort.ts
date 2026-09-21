import type { IAIProvider, ProviderConfig, StreamChunk } from '@repo/types';

/** 首字节（响应头）超时：覆盖 DNS/连接/TLS/上游排队阶段的挂起 */
export const STREAM_TTFB_TIMEOUT_MS = 30_000;

/** 流中静默超时：两次收到数据之间的最大间隔，是现实中最高频的挂起形态 */
export const STREAM_IDLE_TIMEOUT_MS = 90_000;

// ── 错误类型 ──────────────────────────────────────────────────
//
// 两类错误的语义必须分开：超时是真正的失败（会话要落 FAILED），
// 外部中止（客户端断开）不是失败，调用方据此分流。

export class StreamAbortedError extends Error {
  readonly code = 'STREAM_ABORTED';
  constructor(message = 'stream aborted') {
    super(message);
    this.name = 'StreamAbortedError';
  }
}

export class StreamTimeoutError extends Error {
  readonly code = 'STREAM_TIMEOUT';
  constructor(message = 'stream timeout') {
    super(message);
    this.name = 'StreamTimeoutError';
  }
}

export const isStreamAborted = (err: any): boolean =>
  err?.code === 'STREAM_ABORTED';
export const isStreamTimeout = (err: any): boolean =>
  err?.code === 'STREAM_TIMEOUT';

// ── 可中止的 Provider 契约 ────────────────────────────────────
//
// `IAIProvider`（packages/types）保持不变：它没有任何非服务端消费者，
// 而 AbortSignal 是运行期控制状态，不该进可序列化的共享契约。
// 服务端在子接口上追加能力，多出的可选参不影响 2 参调用方
// （model.service 的 testModel 等）。

export interface StreamChatOptions {
  /** 外部中止信号（客户端断开、上层取消） */
  signal?: AbortSignal;
  /** 覆盖默认超时（连接测试可收紧，分析流程可放宽） */
  timeouts?: { ttfbMs?: number; idleMs?: number };
}

/** 共享 IAIProvider 的服务端扩展：可中止 + 可超时 */
export interface IAbortableProvider extends IAIProvider {
  streamChat(
    messages: Array<{ role: string; content: string }>,
    config: ProviderConfig,
    options?: StreamChatOptions,
  ): AsyncGenerator<StreamChunk>;
}

// ── 中止句柄 ──────────────────────────────────────────────────

export interface StreamAbortHandle {
  /** 传给 fetch / 供上层观察 */
  readonly signal: AbortSignal;
  /** 收到响应头后调用：清 TTFB 计时器、武装 idle 计时器 */
  headersReceived(): void;
  /** 每次读到数据后调用：重挂 idle 计时器 */
  bumpIdle(): void;
  /** 收尾调用：清计时器、摘监听、兜底 abort */
  dispose(): void;
}

/**
 * 为一次上游流式请求创建「可中止 + 可超时」句柄。
 *
 * 句柄自建 AbortController 而非直接复用 external：超时需要一个自己的
 * 触发源。外部 signal 用 addEventListener 手工桥接而不用 AbortSignal.any()，
 * 因为后者挂在源 signal 上的监听器只随 GC 释放，长期运行的服务端进程里
 * 会按请求数累积。
 */
export function createStreamAbort(
  external?: AbortSignal,
  timeouts?: StreamChatOptions['timeouts'],
): StreamAbortHandle {
  const ttfbMs = timeouts?.ttfbMs ?? STREAM_TTFB_TIMEOUT_MS;
  const idleMs = timeouts?.idleMs ?? STREAM_IDLE_TIMEOUT_MS;

  const controller = new AbortController();
  let ttfbTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let disposed = false;

  const clearTimers = () => {
    if (ttfbTimer) clearTimeout(ttfbTimer);
    if (idleTimer) clearTimeout(idleTimer);
    ttfbTimer = undefined;
    idleTimer = undefined;
  };

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(new StreamTimeoutError(`上游 ${idleMs}ms 无数据`)),
      idleMs,
    );
  };

  // 已 abort 的 signal 不会再触发 addEventListener —— 必须显式判一次，
  // 否则「在 DB / 取 token 阶段就断开」会被静默忽略到上游自然结束。
  if (external?.aborted) {
    controller.abort(new StreamAbortedError('client disconnected'));
  }

  const onExternalAbort = () =>
    controller.abort(new StreamAbortedError('client disconnected'));
  external?.addEventListener('abort', onExternalAbort, { once: true });

  ttfbTimer = setTimeout(
    () =>
      controller.abort(new StreamTimeoutError(`上游 ${ttfbMs}ms 未返回响应头`)),
    ttfbMs,
  );

  return {
    signal: controller.signal,

    headersReceived() {
      if (disposed) return;
      if (ttfbTimer) {
        clearTimeout(ttfbTimer);
        ttfbTimer = undefined;
      }
      armIdle();
    },

    bumpIdle() {
      if (disposed) return;
      armIdle();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
      external?.removeEventListener('abort', onExternalAbort);
      // 收尾兜底 abort：等价于改造前各 provider 在 finally 里的 aborter.abort()。
      // 此时 reason 已不可观测（读取方都先判过 done），不会污染错误分流。
      if (!controller.signal.aborted) controller.abort();
    },
  };
}

/**
 * 把 reader 收尾统一成「先 cancel 再 releaseLock」。
 *
 * 只 releaseLock 不 cancel 会让 undici 保持连接并把剩余响应缓冲到内存里，
 * 直到上游自己结束 —— 这是改造前三个 provider 共同的资源泄漏。
 * cancel 必须在 abort 之前调用，否则会因为 signal 已 abort 而 reject。
 */
export async function disposeReader(reader: any): Promise<void> {
  try {
    await reader?.cancel?.();
  } catch {
    // 已关闭 / 已 abort
  }
  try {
    reader?.releaseLock?.();
  } catch {
    // 仍有 pending read 时 releaseLock 会抛
  }
}
