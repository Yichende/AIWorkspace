import { View, Text, Image, ScrollView } from '@tarojs/components'
import { parseMarkdownTokens } from '@repo/utils'
import type { Token } from '@repo/utils'
import { useMemo } from 'react'

import './MarkdownBlock.scss'

interface Props {
  content: string
}

// ── Constants ────────────────────────────────────────────────

/** Minimum cell width in rpx */
const MIN_CELL_WIDTH = 120
/** Maximum cell width in rpx */
const MAX_CELL_WIDTH = 360
/** Approximate rpx per Chinese character at 28rpx font-size */
const CHAR_WIDTH = 28
/** Padding inside a cell (left + right in rpx) */
const CELL_PADDING = 40

// ── Inline token helpers ────────────────────────────────────

/** Render inline tokens (text / bold / italic / code / link / image / strikethrough). */
function renderInlines(tokens: Token[] | null, baseKey: string): React.ReactNode[] {
  if (!tokens) return []
  const out: React.ReactNode[] = []

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const key = `${baseKey}-i${i}`

    switch (t.type) {
      case 'text':
        out.push(<Text key={key} className='md-text'>{t.content}</Text>)
        break

      case 'strong_open': {
        const close = findClose(tokens, i, 'strong_close')
        out.push(
          <Text key={key} className='md-strong'>
            {renderInlines(tokens.slice(i + 1, close), key)}
          </Text>,
        )
        i = close
        break
      }

      case 'em_open': {
        const close = findClose(tokens, i, 'em_close')
        out.push(
          <Text key={key} className='md-em'>
            {renderInlines(tokens.slice(i + 1, close), key)}
          </Text>,
        )
        i = close
        break
      }

      case 's_open': {
        const close = findClose(tokens, i, 's_close')
        out.push(
          <Text key={key} className='md-s'>
            {renderInlines(tokens.slice(i + 1, close), key)}
          </Text>,
        )
        i = close
        break
      }

      case 'code_inline':
        out.push(<Text key={key} className='md-code-inline'>{t.content}</Text>)
        break

      case 'link_open': {
        const close = findClose(tokens, i, 'link_close')
        const href = t.attrGet('href') ?? ''
        const children = tokens.slice(i + 1, close)
        const hasText = children.some((c) => c.type === 'text')
        out.push(
          <Text key={key} className='md-link' data-href={href}>
            {renderInlines(children, key)}
            {hasText ? null : <Text className='md-link-url'>{href}</Text>}
          </Text>,
        )
        i = close
        break
      }

      case 'image': {
        const src = t.attrGet('src') ?? ''
        const alt = t.content || ''
        out.push(
          <Image
            key={key}
            className='md-image'
            src={src}
            mode='widthFix'
            aria-label={alt}
          />,
        )
        break
      }

      case 'hardbreak':
        out.push(<View key={key} className='md-br' />)
        break

      case 'softbreak':
        out.push(<Text key={key}> </Text>)
        break

      default:
        if (t.type.endsWith('_close')) break
        if (t.content) {
          out.push(<Text key={key}>{t.content}</Text>)
        }
    }
  }

  return out
}

/** Locate matching close token for inline-level pairs. */
function findClose(tokens: Token[], openIdx: number, closeType: string): number {
  let depth = 1
  const openType = tokens[openIdx].type
  for (let i = openIdx + 1; i < tokens.length; i++) {
    if (tokens[i].type === openType) depth++
    else if (tokens[i].type === closeType) {
      depth--
      if (depth === 0) return i
    }
  }
  return tokens.length - 1
}

/** Find matching close token for block-level pairs (respects nesting). */
function findBlockClose(tokens: Token[], openIdx: number, openType: string, closeType: string): number {
  let depth = 1
  for (let i = openIdx + 1; i < tokens.length; i++) {
    if (tokens[i].type === openType) depth++
    else if (tokens[i].type === closeType) {
      depth--
      if (depth === 0) return i
    }
  }
  return tokens.length - 1
}

// ── Table width calculation ─────────────────────────────────

/** Recursively extract plain text from inline tokens for length measurement. */
function extractPlainText(tokens: Token[] | null): string {
  if (!tokens) return ''
  let text = ''
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        text += t.content
        break
      case 'code_inline':
        text += t.content
        break
      case 'image':
        text += t.attrGet('alt') ?? t.content ?? '[image]'
        break
      case 'softbreak':
      case 'hardbreak':
        text += ' '
        break
      default:
        if (t.children) {
          text += extractPlainText(t.children)
        }
    }
  }
  return text
}

/** Two-pass column width calculation from table tokens. */
function calcColumnWidths(tableTokens: Token[]): number[] {
  // First pass: collect raw text per cell, tracking column index
  const colTexts: string[][] = []

  for (let i = 0; i < tableTokens.length; i++) {
    const t = tableTokens[i]
    if (t.type === 'tr_open') {
      const closeIdx = findBlockClose(tableTokens, i, 'tr_open', 'tr_close')
      let col = 0
      for (let j = i + 1; j < closeIdx; j++) {
        const ct = tableTokens[j]
        if (ct.type === 'th_open' || ct.type === 'td_open') {
          const cellCloseType = ct.type === 'th_open' ? 'th_close' : 'td_close'
          const cellClose = findBlockClose(tableTokens, j, ct.type, cellCloseType)
          const inline = tableTokens[j + 1]
          const plain = extractPlainText(inline?.children ?? null)

          if (!colTexts[col]) colTexts[col] = []
          colTexts[col].push(plain)
          col++
          j = cellClose
        }
      }
      i = closeIdx
    }
  }

  // Second pass: compute width per column from max text length
  return colTexts.map((texts) => {
    const maxLen = Math.max(...texts.map((s) => s.length), 0)
    const contentWidth = maxLen * CHAR_WIDTH + CELL_PADDING
    return Math.min(MAX_CELL_WIDTH, Math.max(MIN_CELL_WIDTH, contentWidth))
  })
}

// ── Block renderer ──────────────────────────────────────────

export default function MarkdownBlock({ content }: Props) {
  const nodes = useMemo(() => {
    const tokens = parseMarkdownTokens(content)

    const blocks: React.ReactNode[] = []
    let keyIdx = 0

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      const key = `b${keyIdx++}`

      switch (t.type) {
        // ── Headings ──
        case 'heading_open': {
          const level = parseInt(t.tag.slice(1), 10)
          const inline = tokens[i + 1]
          blocks.push(
            <View key={key} className={`md-heading md-h${level}`}>
              {renderInlines(inline?.children, key)}
            </View>,
          )
          i += 2
          break
        }

        // ── Paragraph ──
        case 'paragraph_open': {
          const inline = tokens[i + 1]
          blocks.push(
            <View key={key} className='md-paragraph'>
              {renderInlines(inline?.children, key)}
            </View>,
          )
          i += 2
          break
        }

        // ── Fenced code block ──
        case 'fence': {
          const lang = t.info || ''
          blocks.push(
            <View key={key} className='md-code-block'>
              {lang ? <Text className='md-code-lang'>{lang}</Text> : null}
              <Text className='md-code-content' selectable space='ensp'>{t.content}</Text>
            </View>,
          )
          break
        }

        // ── Indented code block (4 spaces / tab) ──
        case 'code_block': {
          blocks.push(
            <View key={key} className='md-code-block'>
              <Text className='md-code-content' selectable space='ensp'>{t.content}</Text>
            </View>,
          )
          break
        }

        // ── Blockquote ──
        case 'blockquote_open': {
          const closeIdx = findBlockClose(tokens, i, 'blockquote_open', 'blockquote_close')
          blocks.push(
            <View key={key} className='md-blockquote'>
              {renderBlockTokens(tokens.slice(i + 1, closeIdx), `${key}-bq`)}
            </View>,
          )
          i = closeIdx
          break
        }

        // ── Unordered list ──
        case 'bullet_list_open': {
          const closeIdx = findBlockClose(tokens, i, 'bullet_list_open', 'bullet_list_close')
          blocks.push(
            <View key={key} className='md-list md-list-bullet'>
              {renderListItems(tokens.slice(i + 1, closeIdx), key, false)}
            </View>,
          )
          i = closeIdx
          break
        }

        // ── Ordered list ──
        case 'ordered_list_open': {
          const closeIdx = findBlockClose(tokens, i, 'ordered_list_open', 'ordered_list_close')
          blocks.push(
            <View key={key} className='md-list md-list-ordered'>
              {renderListItems(tokens.slice(i + 1, closeIdx), key, true)}
            </View>,
          )
          i = closeIdx
          break
        }

        // ── Horizontal rule ──
        case 'hr':
          blocks.push(<View key={key} className='md-hr' />)
          break

        // ── Table ──
        case 'table_open': {
          const closeIdx = findBlockClose(tokens, i, 'table_open', 'table_close')
          const tableBody = tokens.slice(i + 1, closeIdx)
          const colWidths = calcColumnWidths(tableBody)
          const totalWidth = Math.max(colWidths.reduce((sum, w) => sum + w, 0), 600)
          const { rows } = renderTable(tableBody, key, colWidths, totalWidth)
          blocks.push(
            <View key={key} className='md-table'>
              <ScrollView scrollX className='md-table-scroll' enhanced showScrollbar={false}>
                <View className='md-table-inner' style={{ width: `${totalWidth}rpx` }}>
                  {rows}
                </View>
              </ScrollView>
            </View>,
          )
          i = closeIdx
          break
        }

        default:
          break
      }
    }

    return blocks
  }, [content])

  return <View className='markdown-block'>{nodes}</View>
}

// ── Sub-renderers ───────────────────────────────────────────

/** Render tokens inside a block container (blockquote, list item body, etc.). */
function renderBlockTokens(tokens: Token[], baseKey: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let idx = 0

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const key = `${baseKey}-b${idx++}`

    switch (t.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1]
        out.push(
          <View key={key} className='md-paragraph'>
            {renderInlines(inline?.children, key)}
          </View>,
        )
        i += 2
        break
      }
      case 'heading_open': {
        const level = parseInt(t.tag.slice(1), 10)
        const inline = tokens[i + 1]
        out.push(
          <View key={key} className={`md-heading md-h${level}`}>
            {renderInlines(inline?.children, key)}
          </View>,
        )
        i += 2
        break
      }
      case 'fence':
      case 'code_block':
        out.push(
          <View key={key} className='md-code-block'>
            <Text className='md-code-content' selectable space='ensp'>{t.content}</Text>
          </View>,
        )
        break
      case 'hr':
        out.push(<View key={key} className='md-hr' />)
        break
      default:
        break
    }
  }

  return out
}

/** Walk list tokens and render individual items. */
function renderListItems(tokens: Token[], baseKey: string, ordered: boolean): React.ReactNode[] {
  const items: React.ReactNode[] = []
  let num = 0

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'list_item_open') {
      num++
      const closeIdx = findBlockClose(tokens, i, 'list_item_open', 'list_item_close')
      const key = `${baseKey}-li${num}`

      items.push(
        <View key={key} className='md-list-item'>
          <Text className='md-list-marker'>{ordered ? `${num}.` : '•'}</Text>
          <View className='md-list-body'>
            {renderBlockTokens(tokens.slice(i + 1, closeIdx), key)}
          </View>
        </View>,
      )
      i = closeIdx
    }
  }

  return items
}

/** Render table rows with explicit per-column widths and zebra striping. */
function renderTable(
  tokens: Token[],
  baseKey: string,
  colWidths: number[],
  totalWidth: number,
): { rows: React.ReactNode[] } {
  const rows: React.ReactNode[] = []
  let rowIdx = 0
  let isHeader = true

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'tr_open') {
      const closeIdx = findBlockClose(tokens, i, 'tr_open', 'tr_close')
      const cells: React.ReactNode[] = []
      let col = 0

      for (let j = i + 1; j < closeIdx; j++) {
        const ct = tokens[j]
        if (ct.type === 'th_open' || ct.type === 'td_open') {
          const cellCloseType = ct.type === 'th_open' ? 'th_close' : 'td_close'
          const cellClose = findBlockClose(tokens, j, ct.type, cellCloseType)
          const inline = tokens[j + 1]
          const w = colWidths[col] ?? MIN_CELL_WIDTH
          // Quad-lock: WeChat Mini Program flex engine may ignore
          // flex-shrink + width individually; setting all four ensures
          // the cell cannot grow or shrink from its assigned width.
          cells.push(
            <View
              key={`${baseKey}-r${rowIdx}c${col}`}
              className={ct.type === 'th_open' ? 'md-th' : 'md-td'}
              style={{
                flex: 'none',
                width: `${w}rpx`,
                minWidth: `${w}rpx`,
                maxWidth: `${w}rpx`,
              }}
            >
              {renderInlines(inline?.children, `${baseKey}-r${rowIdx}c${col}`)}
            </View>,
          )
          col++
          j = cellClose
        }
      }

      // Zebra striping: header vs body, even vs odd
      let rowClass = 'md-tr'
      if (isHeader) {
        rowClass += ' md-tr-header'
        isHeader = false
      } else {
        rowClass += rowIdx % 2 === 0 ? ' md-tr-even' : ' md-tr-odd'
      }

      // Explicit row width ensures background fills the entire inner container
      rows.push(
        <View
          key={`${baseKey}-r${rowIdx++}`}
          className={rowClass}
          style={{ width: `${totalWidth}rpx`, boxSizing: 'border-box' }}
        >
          {cells}
        </View>,
      )
      i = closeIdx
    }
  }

  return { rows }
}
