/**
 * Truncate text to a max length, appending an ellipsis if truncated.
 */
export function truncateTitle(content: string, maxLen = 20): string {
  return content.length > maxLen ? content.slice(0, maxLen) + '…' : content
}
