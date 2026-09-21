import {
  STREAM_IDLE_TIMEOUT_MS,
  STREAM_TTFB_TIMEOUT_MS,
  StreamAbortedError,
  StreamTimeoutError,
  createStreamAbort,
  disposeReader,
  isStreamAborted,
  isStreamTimeout,
} from './stream-abort';

/** 取 abort reason（Node 的 signal.reason） */
const reason = (signal: AbortSignal): any => (signal as any).reason;

describe('createStreamAbort', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('TTFB 超时：未收到响应头时以 StreamTimeoutError 中止', () => {
    const h = createStreamAbort();
    expect(h.signal.aborted).toBe(false);

    jest.advanceTimersByTime(STREAM_TTFB_TIMEOUT_MS);

    expect(h.signal.aborted).toBe(true);
    expect(isStreamTimeout(reason(h.signal))).toBe(true);
    h.dispose();
  });

  it('headersReceived 清掉 TTFB 计时器，改为只受 idle 计时器管辖', () => {
    const h = createStreamAbort();
    h.headersReceived();

    // 推进到 TTFB 阈值：若计时器没被清掉，此处就会 abort。
    // idle（90s）比 TTFB（30s）长，所以此断言能单独证明 TTFB 已被清除。
    jest.advanceTimersByTime(STREAM_TTFB_TIMEOUT_MS);
    expect(h.signal.aborted).toBe(false);
    expect(STREAM_IDLE_TIMEOUT_MS).toBeGreaterThan(STREAM_TTFB_TIMEOUT_MS);

    h.dispose();
  });

  it('idle 超时：收到响应头后长时间无数据则中止', () => {
    const h = createStreamAbort();
    h.headersReceived();

    jest.advanceTimersByTime(STREAM_IDLE_TIMEOUT_MS);
    expect(h.signal.aborted).toBe(true);
    expect(isStreamTimeout(reason(h.signal))).toBe(true);
    h.dispose();
  });

  it('bumpIdle 重挂计时器：持续有数据就不会超时', () => {
    const h = createStreamAbort();
    h.headersReceived();

    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(STREAM_IDLE_TIMEOUT_MS - 1);
      h.bumpIdle();
    }
    expect(h.signal.aborted).toBe(false);

    // 停止喂数据后最终仍会超时（异常挂起兜底）
    jest.advanceTimersByTime(STREAM_IDLE_TIMEOUT_MS);
    expect(h.signal.aborted).toBe(true);
    h.dispose();
  });

  it('外部中止以 StreamAbortedError 传播（与超时区分）', () => {
    const external = new AbortController();
    const h = createStreamAbort(external.signal);

    external.abort();

    expect(h.signal.aborted).toBe(true);
    expect(isStreamAborted(reason(h.signal))).toBe(true);
    expect(isStreamTimeout(reason(h.signal))).toBe(false);
    h.dispose();
  });

  it('传入已 abort 的 signal 必须立刻中止（不会被 addEventListener 漏掉）', () => {
    const external = new AbortController();
    external.abort();

    const h = createStreamAbort(external.signal);

    expect(h.signal.aborted).toBe(true);
    expect(isStreamAborted(reason(h.signal))).toBe(true);
    h.dispose();
  });

  it('自定义超时时间生效', () => {
    const h = createStreamAbort(undefined, { ttfbMs: 1000 });
    jest.advanceTimersByTime(999);
    expect(h.signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(h.signal.aborted).toBe(true);
    h.dispose();
  });

  it('dispose 清掉所有计时器，不留悬挂定时器', () => {
    const h = createStreamAbort();
    h.headersReceived();
    h.dispose();

    expect(jest.getTimerCount()).toBe(0);
    // dispose 之后再推进时间不应再触发任何 abort
    expect(h.signal.aborted).toBe(true); // dispose 自身兜底 abort
  });

  it('dispose 摘掉外部监听：之后外部 abort 不会再触发', () => {
    const external = new AbortController();
    const h = createStreamAbort(external.signal);
    h.dispose();

    const before = reason(h.signal);
    external.abort();

    // reason 未被 StreamAbortedError 覆盖（dispose 的兜底 abort 不带该 reason）
    expect(reason(h.signal)).toBe(before);
  });

  it('dispose 后可重复调用，不抛错', () => {
    const h = createStreamAbort();
    expect(() => {
      h.dispose();
      h.dispose();
      h.headersReceived();
      h.bumpIdle();
    }).not.toThrow();
  });

  it('错误类可被 isStreamAborted / isStreamTimeout 识别', () => {
    expect(isStreamAborted(new StreamAbortedError())).toBe(true);
    expect(isStreamTimeout(new StreamTimeoutError())).toBe(true);
    expect(isStreamAborted(new StreamTimeoutError())).toBe(false);
    expect(isStreamTimeout(new Error('包裹后的普通错误'))).toBe(false);
  });
});

describe('disposeReader', () => {
  it('先 cancel 再 releaseLock', async () => {
    const calls: string[] = [];
    await disposeReader({
      cancel: async () => {
        calls.push('cancel');
      },
      releaseLock: () => {
        calls.push('releaseLock');
      },
    });
    expect(calls).toEqual(['cancel', 'releaseLock']);
  });

  it('cancel / releaseLock 抛错时都不冒泡', async () => {
    await expect(
      disposeReader({
        cancel: async () => {
          throw new Error('已 abort');
        },
        releaseLock: () => {
          throw new Error('有 pending read');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
