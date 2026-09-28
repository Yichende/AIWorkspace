import { isDurationLike, parseDurationMs } from './duration.util';

describe('parseDurationMs', () => {
  it('解析常用单位', () => {
    expect(parseDurationMs('500ms', 0)).toBe(500);
    expect(parseDurationMs('30s', 0)).toBe(30_000);
    expect(parseDurationMs('15m', 0)).toBe(900_000);
    expect(parseDurationMs('12h', 0)).toBe(43_200_000);
    expect(parseDurationMs('7d', 0)).toBe(604_800_000);
    expect(parseDurationMs('1w', 0)).toBe(604_800_000);
  });

  it('接受长写法与带空格写法', () => {
    expect(parseDurationMs('2 days', 0)).toBe(172_800_000);
    expect(parseDurationMs('1hour', 0)).toBe(3_600_000);
    expect(parseDurationMs('30 MINS', 0)).toBe(1_800_000);
  });

  it('接受小数', () => {
    expect(parseDurationMs('1.5h', 0)).toBe(5_400_000);
  });

  it('空值 / undefined 走 fallback', () => {
    expect(parseDurationMs(undefined, 123)).toBe(123);
    expect(parseDurationMs('', 123)).toBe(123);
    expect(parseDurationMs('   ', 123)).toBe(123);
  });

  it('拒绝裸数字，并说清 1000 倍差异的原因', () => {
    // ms('604800') 是 604.8 秒而不是 7 天。环境变量的值永远是字符串，
    // 所以这个坑一定会踩到 —— 报错比猜用户想表达秒还是毫秒更安全。
    expect(() => parseDurationMs('604800', 0)).toThrow(/必须带单位/);
    expect(() => parseDurationMs('604800', 0)).toThrow(/1000 倍/);
  });

  it.each(['1d12h', 'abc', '7 days ago', '-1d', '0d', 'd', '15 m 3s'])(
    '非法值 %s 抛 RangeError',
    (raw) => {
      expect(() => parseDurationMs(raw, 0)).toThrow(RangeError);
    },
  );
});

describe('isDurationLike', () => {
  it('合法取值返回 true', () => {
    expect(isDurationLike('15m')).toBe(true);
    expect(isDurationLike('7d')).toBe(true);
    expect(isDurationLike('500ms')).toBe(true);
    expect(isDurationLike('1w')).toBe(true);
  });

  it('非法取值返回 false 且不抛错', () => {
    expect(isDurationLike('1month')).toBe(false);
    expect(isDurationLike('1d12h')).toBe(false);
    expect(isDurationLike('')).toBe(false);
    expect(isDurationLike('604800')).toBe(false);
  });

  it('与 parseDurationMs 的判定一致', () => {
    // 启动期用 isDurationLike 决定要不要报错，运行期用 parseDurationMs 取值 ——
    // 两者判定不一致会出现「启动放过了、运行期抛错」的裂缝
    for (const raw of ['15m', '7d', 'abc', '1d12h', '604800', '30s']) {
      const parseThrows = (() => {
        try {
          parseDurationMs(raw, 0);
          return false;
        } catch {
          return true;
        }
      })();
      expect(isDurationLike(raw)).toBe(!parseThrows);
    }
  });
});
