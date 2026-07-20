import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'

// ── Parser instance ──────────────────────────────────────────
// html: false disables raw HTML passthrough (XSS hardening).
// linkify: true auto-converts URLs to clickable links.
// breaks: true converts single \n to <br> (GitHub-flavored).

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

/**
 * Render Markdown text to an HTML string.
 *
 * Use on the **server** (e.g. include in API responses) or on
 * **H5** (pass to `dangerouslySetInnerHTML` / Taro `RichText`
 * with `type="html"`).
 *
 * ⚠ On WeChat Mini Programs the native `<rich-text>` component
 * only accepts a nodes array — prefer {@link parseMarkdownTokens}
 * and render with native Taro components there.
 */
export function renderMarkdown(text: string): string {
  return md.render(text)
}

/**
 * Parse Markdown text into a Token AST.
 *
 * Each token describes a block or inline element (heading,
 * paragraph, code block, table row, etc.).  Walk the array and
 * map each token to platform-native components.
 *
 * ### Typical WeChat Mini Program pattern
 *
 * ```ts
 * import { parseMarkdownTokens } from '@repo/utils'
 *
 * tokens.map(token => {
 *   switch (token.type) {
 *     case 'heading_open':  return <View className={`h${token.tag.slice(1)}`} />
 *     case 'inline':        return <Text>{renderInlines(token.children)}</Text>
 *     case 'fence':         return <View className="code-block">{token.content}</View>
 *     // …
 *   }
 * })
 * ```
 *
 * ### Token structure (simplified)
 *
 * | token.type       | key fields                 |
 * |------------------|----------------------------|
 * | `heading_open`   | `tag`, `markup`            |
 * | `heading_close`  | `tag`                      |
 * | `paragraph_open` | —                          |
 * | `inline`         | `children` (inline tokens) |
 * | `fence`          | `content`, `info` (lang)   |
 * | `table_open`     | —                          |
 * | `tr_open` / `td_open` | —                     |
 * | `bullet_list_open` | —                        |
 * | `list_item_open` | —                          |
 * | `blockquote_open`| —                          |
 */
export function parseMarkdownTokens(text: string): Token[] {
  return md.parse(text, {})
}

export type { Token }
