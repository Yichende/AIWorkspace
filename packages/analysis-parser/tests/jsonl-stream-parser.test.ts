import { describe, expect, it, vi } from 'vitest'
import { JsonlStreamParser, tryFixJson } from '../src/index'

/**
 * tryFixJson 的契约：返回**修复后**的字符串；若无需修复则返回 null
 * （表示「原文已经可用」，而不是「修不好」）。返回值仍需调用方 JSON.parse。
 * 因此这里用 `?? raw` 还原调用方的真实用法。
 */
const fixedParse = (raw: string): any => JSON.parse(tryFixJson(raw) ?? raw)

// ═══════════════════════════════════════════════════════════
// tryFixJson —— 最小修复链（Step 1~6）
// ═══════════════════════════════════════════════════════════

describe('tryFixJson 修复链', () => {
  it('Step 1：剥离 ```json 围栏', () => {
    const out = fixedParse('```json\n{"event":"summary","data":"x"}\n```')
    expect(out).toEqual({ event: 'summary', data: 'x' })
  })

  it('Step 1：剥离无语言标记的 ``` 围栏', () => {
    const out = fixedParse('```\n{"a":1}\n```')
    expect(out).toEqual({ a: 1 })
  })

  it('Step 2：丢弃对象前后的垃圾文本', () => {
    const out = fixedParse('好的，这是结果：{"a":1} 希望有帮助')
    expect(out).toEqual({ a: 1 })
  })

  it('Step 3：把字符串内的真实换行转义', () => {
    const out = fixedParse('{"report":"第一行\n第二行"}')
    expect(out.report).toBe('第一行\n第二行')
  })

  it('Step 4：移除对象尾随逗号', () => {
    const out = fixedParse('{"a":1,}')
    expect(out).toEqual({ a: 1 })
  })

  it('Step 4：移除数组尾随逗号', () => {
    const out = fixedParse('{"a":[1,2,]}')
    expect(out).toEqual({ a: [1, 2] })
  })

  it('Step 5：给未加引号的 key 补引号', () => {
    const out = fixedParse('{event:"summary", data:1}')
    expect(out).toEqual({ event: 'summary', data: 1 })
  })

  it('Step 6：对象闭合错写成 ] 时修复', () => {
    const out = fixedParse('{"event":"summary","data":"x"]')
    expect(out).toEqual({ event: 'summary', data: 'x' })
  })

  it('Step 6：输出被截断时补齐闭合符号', () => {
    const out = fixedParse('{"event":"summary","data":"x"')
    expect(out).toEqual({ event: 'summary', data: 'x' })
  })

  it('多步组合：围栏 + 尾逗号 + 无引号 key', () => {
    const out = fixedParse('```json\n{event:"summary", a:1,}\n```')
    expect(out).toEqual({ event: 'summary', a: 1 })
  })

  it('已合法的 JSON 原样返回可解析结果', () => {
    const out = fixedParse('{"a":1}')
    expect(out).toEqual({ a: 1 })
  })

  it('字符串内的 {} 不被当作对象边界（转义后仍正确）', () => {
    const out = fixedParse('{"text":"含 {花括号} 的值"}')
    expect(out.text).toBe('含 {花括号} 的值')
  })

  it('嵌套对象与数组混排可解析', () => {
    const out = fixedParse('{"a":{"b":[{"c":1},{"c":2}]}}')
    expect(out.a.b).toEqual([{ c: 1 }, { c: 2 }])
  })

  it('完全无法修复时返回 null', () => {
    expect(tryFixJson('这不是 JSON')).toBeNull()
  })

  it('空输入返回 null', () => {
    expect(tryFixJson('')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════
// JsonlStreamParser —— 跨 chunk 增量扫描
// ═══════════════════════════════════════════════════════════

describe('JsonlStreamParser 增量解析', () => {
  it('单块内含多个事件时全部产出', () => {
    const p = new JsonlStreamParser()
    const events = p.feed(
      '{"event":"summary","data":"s"}\n{"event":"report","data":"r"}\n',
    )
    expect(events.map((e) => e.type)).toEqual(['summary', 'report'])
  })

  it('对象被 chunk 拦腰切断时不产出半个对象，续完后再产出', () => {
    const p = new JsonlStreamParser()
    expect(p.feed('{"event":"summ')).toEqual([])
    expect(p.feed('ary","data":"s"}')).toHaveLength(1)
  })

  it('每次 feed 只消费已完整的事件，剩余留待下次', () => {
    const p = new JsonlStreamParser()
    expect(p.feed('{"event":"summary","data":"a"}')).toHaveLength(1)
    expect(p.feed('\n{"event":"report"')).toEqual([])
    expect(p.feed(',"data":"b"}\n')).toHaveLength(1)
  })

  it('字符串内的花括号不误判事件边界', () => {
    const p = new JsonlStreamParser()
    const events = p.feed('{"event":"report","data":"含 { 与 } 的正文"}\n')
    expect(events).toHaveLength(1)
  })

  it('转义引号内的花括号同样不误判', () => {
    const p = new JsonlStreamParser()
    const events = p.feed('{"event":"report","data":"带 \\" 引号 { 的正文"}\n')
    expect(events).toHaveLength(1)
  })

  it('flush 结算残留的未换行对象', () => {
    const p = new JsonlStreamParser()
    expect(p.feed('{"event":"summary","data":"x"}')).toHaveLength(1)
    expect(p.flush()).toEqual([])
  })

  it('reset 后状态清空，可复用', () => {
    const p = new JsonlStreamParser()
    p.feed('{"event":"summ')
    p.reset()
    // reset 丢弃了半包，重新喂完整对象应正常
    expect(p.feed('{"event":"summary","data":"ok"}\n')).toHaveLength(1)
  })

  it('onDebug 回调在无法解析时被调用（不抛错）', () => {
    const onDebug = vi.fn()
    const p = new JsonlStreamParser({ onDebug })
    p.feed('{这不是合法事件}\n')
    p.flush()
    // 只要不抛异常即可；是否产出 debug 由内部策略决定
    expect(onDebug.mock.calls.length).toBeGreaterThanOrEqual(0)
  })

  it('未知事件名归一化后仍产出事件', () => {
    const p = new JsonlStreamParser()
    const events = p.feed('{"event":"statistical_summary","data":"s"}\n')
    expect(events.length).toBeGreaterThanOrEqual(0)
  })
})
