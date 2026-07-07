import type { SessionIndexItem, ChatHistoryGroup, ChatHistoryItem, TimeGroup } from '@repo/types'

// ── Default labels (Chinese) ─────────────────────────────────

const DEFAULT_GROUP_LABEL: Record<TimeGroup, string> = {
  today: '今天',
  yesterday: '昨天',
  thisWeek: '最近一周',
  earlier: '更早',
}

// ── Grouping ──────────────────────────────────────────────────

const DAY = 86400000

function groupSession(ts: number): TimeGroup {
  const now = Date.now()
  const dayStart = now - (now % DAY)
  if (ts >= dayStart) return 'today'
  if (ts >= dayStart - DAY) return 'yesterday'
  if (ts >= dayStart - 7 * DAY) return 'thisWeek'
  return 'earlier'
}

/**
 * Build history groups from session index items (no messages needed).
 * @param items - Session metadata array
 * @param labels - Optional custom group labels (defaults to Chinese)
 */
export function buildHistoryGroups(
  items: SessionIndexItem[],
  labels: Record<TimeGroup, string> = DEFAULT_GROUP_LABEL,
): ChatHistoryGroup[] {
  const map = new Map<TimeGroup, ChatHistoryItem[]>()

  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)

  for (const s of sorted) {
    const g = groupSession(s.updatedAt)
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      model: s.model,
    })
  }

  const order: TimeGroup[] = ['today', 'yesterday', 'thisWeek', 'earlier']
  return order
    .filter((g) => map.has(g))
    .map((g) => ({ label: labels[g], group: g, items: map.get(g)! }))
}
