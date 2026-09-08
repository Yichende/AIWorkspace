import { describe, expect, it } from 'vitest'
import {
  parseSseFrame,
  SseFrameReader,
  Utf8StreamDecoder,
} from '../src/utils/sse'

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8') // Node 内置解码器，仅测试期参照用

const R = '�'

/** 把字符串喂给一个全新解码器，并返回字节切分在 p 处的结果（两个 chunk） */
function decodeInTwoParts(s: string, p: number): string {
  const d = new Utf8StreamDecoder()
  const bytes = enc.encode(s)
  return (
    d.decode(bytes.slice(0, p)) +
    d.decode(bytes.slice(p)) +
    d.flush()
  )
}

describe('Utf8StreamDecoder 单块解码正确性', () => {
  it('混合平面字符串逐字还原（ASCII/2字节/3字节/4字节）', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(enc.encode('Aé测😀'))).toBe('Aé测😀')
  })

  it.each(['', 'A', 'é', '测', '😀', 'Aé测😀z', '我很😀好', '🇨🇳🀄', '😀😃😄😁😆😅'])(
    '整块解码与 Node TextDecoder 一致：%s',
    (s) => {
      const d = new Utf8StreamDecoder()
      expect(d.decode(enc.encode(s))).toBe(dec.decode(enc.encode(s)))
    },
  )

  it('任一字节切割点拆两块喂入，输出与原文一致且无 U+FFFD（跨块状态修复）', () => {
    const fixtures = [
      'x测y😀z',
      '我很😀好',
      '🇨🇳🀄',
      'A long CJK 中文串 with emoji 🚀🚀 and 更多汉字边界测试😁',
    ]
    for (const s of fixtures) {
      const bytes = enc.encode(s)
      for (let p = 0; p <= bytes.length; p++) {
        const got = decodeInTwoParts(s, p)
        expect(got).toBe(s)
        expect(got).not.toContain(R)
      }
    }
  })
})

describe('Utf8StreamDecoder 跨 chunk 字节残留状态', () => {
  it('emoji 逐字节喂入：前三次空输出，第四次出整字符', () => {
    const d = new Utf8StreamDecoder()
    const bytes = enc.encode('😀') // F0 9F 98 80
    let out = ''
    for (let i = 0; i < 3; i++) {
      expect(d.decode(bytes.slice(i, i + 1))).toBe('')
    }
    out += d.decode(bytes.slice(3))
    expect(out).toBe('😀')
  })

  it('3 字节 CJK 截断 lead 后下块续完', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(Uint8Array.from([0xe6]))).toBe('')
    expect(d.decode(Uint8Array.from([0xb5, 0x8b]))).toBe('测')
  })

  it('3 字节 CJK 截断两位后下块补一位', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(Uint8Array.from([0xe6, 0xb5]))).toBe('')
    expect(d.decode(Uint8Array.from([0x8b]))).toBe('测')
  })

  it('字符切在 ASCII 之间不影响相邻内容', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(enc.encode('A'))).toBe('A')
    expect(d.decode(Uint8Array.from([0xe6]))).toBe('') // '测' 的 lead 截断
    expect(d.decode(Uint8Array.from([0xb5]))).toBe('') // 续一字节仍截断
    expect(d.decode(Uint8Array.from([0x8b]))).toBe('测') // 补全
    expect(d.decode(enc.encode('B'))).toBe('B')
  })
})

describe('Utf8StreamDecoder flush（流结束残留）', () => {
  it('截断前缀 flush 输出一个 U+FFFD，之后为空', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(Uint8Array.from([0xf0, 0x9f, 0x98]))).toBe('')
    expect(d.flush()).toBe(R)
    expect(d.flush()).toBe('')
  })

  it('空状态 flush 无输出', () => {
    const d = new Utf8StreamDecoder()
    d.decode(enc.encode('abc'))
    expect(d.flush()).toBe('')
  })

  it('截断后仍可续收并完整解码', () => {
    const d = new Utf8StreamDecoder()
    d.decode(Uint8Array.from([0xe6])) // '测' 的 lead 先到
    d.decode(Uint8Array.from([0xb5])) // 续一字节，仍截断
    expect(d.decode(Uint8Array.from([0x8b]))).toBe('测') // 补全
    expect(d.decode(enc.encode('y'))).toBe('y')
  })
})

describe('Utf8StreamDecoder 非法输入（U+FFFD + resync）', () => {
  it('孤立续字节', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(Uint8Array.from([0x41, 0x80, 0x42]))).toBe('A�B')
  })

  it('非法 lead：0xC0/0xC1/0xF5/0xFF', () => {
    const cases: Array<[number[], string]> = [
      [[0xc0, 0x41], `${R}A`],
      [[0xc1, 0x80, 0x41], `${R}${R}A`],
      [[0xf5, 0x41], `${R}A`],
      [[0xff, 0x41], `${R}A`],
    ]
    for (const [bytes, expected] of cases) {
      const d = new Utf8StreamDecoder()
      expect(d.decode(Uint8Array.from(bytes))).toBe(expected)
    }
  })

  it('非法续字节 resync 后 ASCII 不被吞', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(Uint8Array.from([0xe4, 0x41, 0x42]))).toBe(`${R}AB`)
    const d2 = new Utf8StreamDecoder()
    expect(d2.decode(Uint8Array.from([0xf0, 0x9f, 0x41]))).toBe(`${R}${R}A`)
  })

  it('二阶约束：overlong / surrogate 区间 / 超 U+10FFFF', () => {
    const cases: Array<[number[], string]> = [
      [[0xe0, 0x80, 0x80], `${R}${R}${R}`], // overlong 3 字节
      [[0xed, 0xa0, 0x80], `${R}${R}${R}`], // surrogate 区间 D800
      [[0xf4, 0x90, 0x80, 0x80], `${R}${R}${R}${R}`], // > U+10FFFF
      [[0xf0, 0x80, 0x80, 0x80], `${R}${R}${R}${R}`], // overlong 4 字节
    ]
    for (const [bytes, expected] of cases) {
      const d = new Utf8StreamDecoder()
      expect(d.decode(Uint8Array.from(bytes))).toBe(expected)
    }
  })

  it('出错后解码器状态不脏，可继续正常解码', () => {
    const d = new Utf8StreamDecoder()
    d.decode(Uint8Array.from([0xc0, 0x41]))
    d.decode(Uint8Array.from([0xf0]))
    expect(d.decode(Uint8Array.from([0x9f, 0x98, 0x80]))).toBe('😀')
    expect(d.decode(enc.encode('ok'))).toBe('ok')
  })

  it('decode 接受 ArrayBuffer 入参', () => {
    const d = new Utf8StreamDecoder()
    expect(d.decode(enc.encode('😀').buffer)).toBe('😀')
  })
})

describe('parseSseFrame', () => {
  it('基本解析', () => {
    expect(parseSseFrame('event: content\ndata: hello')).toEqual({
      event: 'content',
      data: 'hello',
    })
  })

  it('多行 data 以 \\n 连接', () => {
    expect(parseSseFrame('event: done\ndata: line1\ndata: line2')).toEqual({
      event: 'done',
      data: 'line1\nline2',
    })
  })

  it('未知行忽略', () => {
    expect(parseSseFrame('foo: bar\nevent: x\ndata: v')).toEqual({
      event: 'x',
      data: 'v',
    })
  })

  it('前缀精确且大小写敏感（Event: / 不带空格的 event:/data: 不识别）', () => {
    expect(parseSseFrame('Event: X\ndata: y')).toEqual({ event: '', data: 'y' })
    expect(parseSseFrame('event:X\ndata:y')).toEqual({ event: '', data: '' })
  })

  it('event trim 而 data 不 trim', () => {
    expect(parseSseFrame('event:  done  \ndata:   padded')).toEqual({
      event: 'done',
      data: '  padded',
    })
  })

  it('空输入', () => {
    expect(parseSseFrame('')).toEqual({ event: '', data: '' })
  })
})

describe('SseFrameReader 端到端拆帧', () => {
  function collect() {
    const frames: Array<{ event: string; data: string }> = []
    const reader = new SseFrameReader((f) => frames.push(f))
    return { frames, reader }
  }

  it('单块完整帧只分发一次', () => {
    const { frames, reader } = collect()
    reader.feed(enc.encode('event: content\ndata: hello\n\n'))
    expect(frames).toEqual([{ event: 'content', data: 'hello' }])
  })

  it('帧跨两次 feed 拆分（半包）仍完整分发', () => {
    const { frames, reader } = collect()
    reader.feed(enc.encode('event: content\ndata: hel'))
    reader.feed(enc.encode('lo\n\n'))
    expect(frames).toEqual([{ event: 'content', data: 'hello' }])
  })

  it('一个 chunk 含多帧（粘包）按序分发', () => {
    const { frames, reader } = collect()
    reader.feed(enc.encode('event: content\ndata: a\n\nevent: done\ndata: b\n\n'))
    expect(frames).toEqual([
      { event: 'content', data: 'a' },
      { event: 'done', data: 'b' },
    ])
  })

  it('帧内 data 多行经拆帧不被破坏', () => {
    const { frames, reader } = collect()
    reader.feed(enc.encode('event: report\ndata: line1\ndata: line2\n\n'))
    expect(frames).toEqual([{ event: 'report', data: 'line1\nline2' }])
  })

  it('帧内多字节字符跨 feed 字节级切断 → 完整分发且无 U+FFFD', () => {
    const { frames, reader } = collect()
    const payload = '我很😀好'
    const frame = enc.encode(`event: content\ndata: ${payload}\n\n`)
    const head = enc.encode('event: content\ndata: ')
    const cutInsideEmoji = head.length + enc.encode('我很').length + 2
    reader.feed(frame.slice(0, cutInsideEmoji))
    reader.feed(frame.slice(cutInsideEmoji))
    expect(frames).toEqual([{ event: 'content', data: payload }])
    expect(frames[0].data).not.toContain(R)
  })

  it('无尾空行的帧 feed 不分发，end() 作为尾帧分发一次', () => {
    const { frames, reader } = collect()
    reader.feed(enc.encode('event: done\ndata: {}'))
    expect(frames).toEqual([])
    reader.end()
    expect(frames).toEqual([{ event: 'done', data: '{}' }])
  })

  it('纯空白尾帧不分发', () => {
    const { frames, reader } = collect()
    reader.feed(enc.encode('event: content\ndata: x\n\n  '))
    expect(frames).toHaveLength(1)
    reader.end()
    expect(frames).toHaveLength(1)
  })

  it('end() 幂等；未喂任何数据时安全', () => {
    const { frames, reader } = collect()
    reader.end()
    reader.end()
    expect(frames).toEqual([])
  })

  it('feed 接受 ArrayBuffer 入参', () => {
    const { frames, reader } = collect()
    reader.feed(enc.encode('event: content\ndata: hi\n\n').buffer as ArrayBuffer)
    expect(frames).toEqual([{ event: 'content', data: 'hi' }])
  })
})
