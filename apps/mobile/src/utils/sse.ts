/**
 * SSE 收流共享骨架（chat.api.ts / analysis.api.ts 共用）。
 *
 * 两个问题在此收敛：
 * 1. 小程序无 TextDecoder，需要手写 UTF-8 解码；
 *    且解码必须带跨 chunk 状态 —— 一个多字节字符被切在两个 chunk
 *    的字节边界上时，残留字节要留在本端等下块续完（否则产生乱码）。
 * 2. SSE 帧以 \n\n 结尾，但 chunk 边界与帧边界不对齐（半包/粘包），
 *    需要 buffer + 拆帧留尾。
 *
 * 本模块只做「解码 + 拆帧 + 分发完整帧」，不含任何业务事件语义；
 * 各 service 自行持有从 SseFrame 到业务回调的分发 switch。
 */

export interface SseFrame {
  event: string
  data: string
}

export type SseFrameHandler = (frame: SseFrame) => void

const REPLACEMENT = '�'

/**
 * 增量 UTF-8 解码器：跨 chunk 保留未完成的多字节字符前缀。
 *
 * 错误处理语义（WHATWG 式 resync）：
 * - 孤立续字节 / 非法 lead（0xC0/0xC1、0xF5+）→ 输出一个 U+FFFD；
 * - 续字节非法或二阶约束失败（0xE0/0xED/0xF0/0xF4 的第二个字节越界）
 *   → 输出一个 U+FFFD，只消费 lead 字节，再以该非法字节为新起点重新分类；
 * - chunk 结束时若处于合法前缀（lead + 合法续字节）→ 前缀留到下次 decode；
 * - flush()：流结束时残留前缀 → 输出一个 U+FFFD。
 */
export class Utf8StreamDecoder {
  private pending = new Uint8Array(0)

  decode(chunk: ArrayBuffer | Uint8Array): string {
    const incoming =
      chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk

    // 续接上一块残留的前缀字节
    let bytes = incoming
    if (this.pending.length) {
      bytes = new Uint8Array(this.pending.length + incoming.length)
      bytes.set(this.pending, 0)
      bytes.set(incoming, this.pending.length)
      this.pending = new Uint8Array(0)
    }

    let out = ''
    let i = 0
    const n = bytes.length

    while (i < n) {
      const b = bytes[i]

      // ASCII
      if (b < 0x80) {
        out += String.fromCharCode(b)
        i++
        continue
      }

      // 判定多字节序列长度；非法 lead / 孤立续字节落空
      let len = 0
      if (b >= 0xc2 && b <= 0xdf) len = 2
      else if (b >= 0xe0 && b <= 0xef) len = 3
      else if (b >= 0xf0 && b <= 0xf4) len = 4
      if (!len) {
        out += REPLACEMENT
        i++
        continue
      }

      // 本块内不够凑齐整字符 —— 校验已有字节为合法前缀后留待下块
      if (i + len > n) {
        let prefixOk = true
        for (let k = 1; k < len && i + k < n; k++) {
          const c = bytes[i + k]
          if (c < 0x80 || c > 0xbf || (k === 1 && !secondByteInRange(b, c))) {
            prefixOk = false
            break
          }
        }
        if (prefixOk) {
          this.pending = bytes.slice(i)
          break
        }
        // 前缀本身非法 —— 按错误处理只消费 lead，随后 resync
        out += REPLACEMENT
        i++
        continue
      }

      // 完整序列在块内 —— 校验续字节后拼码点
      let valid = true
      for (let k = 1; k < len; k++) {
        const c = bytes[i + k]
        if (c < 0x80 || c > 0xbf || (k === 1 && !secondByteInRange(b, c))) {
          valid = false
          break
        }
      }
      if (!valid) {
        out += REPLACEMENT
        i++
        continue
      }

      let cp = b & (len === 2 ? 0x1f : len === 3 ? 0x0f : 0x07)
      for (let k = 1; k < len; k++) {
        cp = (cp << 6) | (bytes[i + k] & 0x3f)
      }
      i += len
      if (len === 4) {
        // 4 字节序列 → 码点超出 BMP，拼 surrogate pair（emoji 安全）
        const x = cp - 0x10000
        out += String.fromCharCode(0xd800 + (x >> 10), 0xdc00 + (x & 0x3ff))
      } else {
        out += String.fromCharCode(cp)
      }
    }

    return out
  }

  /** 流结束：残留的不完整前缀输出一个 U+FFFD（空则无输出） */
  flush(): string {
    if (!this.pending.length) return ''
    this.pending = new Uint8Array(0)
    return REPLACEMENT
  }
}

/** lead 的第二个字节范围约束（防 overlong 与 surrogate 区间、超 U+10FFFF）；调用方保证 c 已是续字节 */
function secondByteInRange(b: number, c: number): boolean {
  if (b === 0xe0) return c >= 0xa0
  if (b === 0xed) return c <= 0x9f
  if (b === 0xf0) return c >= 0x90
  if (b === 0xf4) return c <= 0x8f
  return true
}

/**
 * 解析单个 SSE 帧文本（一个完整帧，不含结尾 \n\n）：
 * - `event: X`（前缀精确含空格）→ event = X.trim()；
 * - `data: X` → 多行 data 以 '\n' 连接，内容不 trim；
 * - 其余行忽略；大小写敏感。
 */
export function parseSseFrame(raw: string): SseFrame {
  let event = ''
  let data = ''

  const lines = raw.split('\n')
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      if (data) data += '\n'
      data += line.slice(6)
    }
  }

  return { event, data }
}

/**
 * 帧读取器：拥有增量解码器 + 文本 buffer，负责「解码 → 累积 → 拆帧留尾 → 分发完整帧」。
 * - feed(chunk)：一个 chunk 可能含多帧、半帧、或恰好卡在多字节字符中间；
 * - end()：流结束时 flush 解码残留，并把未以 \n\n 收尾的尾帧作为最后一帧分发
 *   （空白尾不分发），调用后幂等。
 */
export class SseFrameReader {
  private decoder = new Utf8StreamDecoder()
  private textBuffer = ''

  constructor(private readonly onFrame: SseFrameHandler) {}

  feed(chunk: ArrayBuffer | Uint8Array): void {
    this.textBuffer += this.decoder.decode(chunk)

    // 按空行切帧；最后一段可能不完整 —— 留回 buffer 等下个 chunk（半包拆帧）
    const parts = this.textBuffer.split('\n\n')
    this.textBuffer = parts.pop() || ''

    for (const part of parts) {
      if (!part.trim()) continue
      this.onFrame(parseSseFrame(part))
    }
  }

  /** 请求结束（success）时调用一次：解码尾残留 + 处理未收尾的尾帧 */
  end(): void {
    this.textBuffer += this.decoder.flush()
    if (this.textBuffer.trim()) {
      this.onFrame(parseSseFrame(this.textBuffer))
    }
    this.textBuffer = ''
  }
}
