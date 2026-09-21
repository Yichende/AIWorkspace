import { describe, expect, it } from 'vitest'
import { ThinkTagParser } from '../src/index'

/**
 * 真实契约：解析器为了识别跨 chunk 的半截标签，会把**短于标签长度**的尾部
 * 暂时扣在 buffer 里不产出。因此只有 feed() + flush() 合起来才是完整产出；
 * 生产代码（analysis-queue）也是在流末尾调 flush() 结算的。
 */
const run = (p: ThinkTagParser, ...chunks: string[]) => [
  ...chunks.flatMap((c) => p.feed(c)),
  ...p.flush(),
]

const joinByType = (chunks: Array<{ type: string; content: string }>) => ({
  thinking: chunks
    .filter((c) => c.type === 'thinking')
    .map((c) => c.content)
    .join(''),
  answer: chunks
    .filter((c) => c.type === 'answer')
    .map((c) => c.content)
    .join(''),
})

describe('ThinkTagParser 三态状态机', () => {
  it('无标签时全文按 answer 输出（需 flush 结算短尾）', () => {
    expect(joinByType(run(new ThinkTagParser(), '普通正文'))).toEqual({
      thinking: '',
      answer: '普通正文',
    })
  })

  it('<think>…</think> 之间的内容归 thinking，之后归 answer', () => {
    const out = run(new ThinkTagParser(), '<think>思考过程</think>回答内容')
    expect(joinByType(out)).toEqual({
      thinking: '思考过程',
      answer: '回答内容',
    })
  })

  it('标签前的正文归 answer', () => {
    const out = run(new ThinkTagParser(), '前置正文<think>思考</think>后置')
    expect(joinByType(out)).toEqual({ thinking: '思考', answer: '前置正文后置' })
  })

  it('未闭合的 <think> 内容在 flush 时按 thinking 结算', () => {
    const out = run(new ThinkTagParser(), '<think>思考中')
    expect(joinByType(out).thinking).toBe('思考中')
  })

  it('孤儿 </think>（部分 Ollama 版本剥掉开标签）→ 之前的内容全按 thinking', () => {
    const out = run(new ThinkTagParser(), '没有开标签的思考</think>正文')
    expect(joinByType(out)).toEqual({
      thinking: '没有开标签的思考',
      answer: '正文',
    })
  })

  it('半个开标签跨 chunk 时不会被当成正文吐出去', () => {
    const p = new ThinkTagParser()
    // '<thi' 短于 '<think>'，必须留在 buffer 里
    expect(p.feed('<thi')).toEqual([])
    const out = [...p.feed('nk>思考</think>正文'), ...p.flush()]
    expect(joinByType(out)).toEqual({ thinking: '思考', answer: '正文' })
  })

  it('</think 被截断时保留尾部，续包后正确收尾', () => {
    const p = new ThinkTagParser()
    expect(joinByType(p.feed('<think>思考</thi')).thinking).toBe('')

    const out = [...p.feed('nk>正文'), ...p.flush()]
    expect(joinByType(out)).toEqual({ thinking: '思考', answer: '正文' })
  })

  it('标签首字符与其余部分被切开仍能识别', () => {
    const out = run(new ThinkTagParser(), '<', 'think>思考</think>正文')
    expect(joinByType(out)).toEqual({ thinking: '思考', answer: '正文' })
  })

  it('空 feed 不产出', () => {
    const p = new ThinkTagParser()
    expect(p.feed('')).toEqual([])
  })

  it('flush 幂等：连续调用不重复产出', () => {
    const p = new ThinkTagParser()
    const first = run(p, '<think>思考中')
    expect(joinByType(first).thinking).toBe('思考中')
    expect(p.flush()).toEqual([])
  })
})
