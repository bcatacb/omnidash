export type RawGroupRow = {
  id: string
  name: string
  accountId: string
  accountUsername: string
  membersCount: number
  type: 'group' | 'channel'
  username: string | null
  lastMessage: string
  lastMessageDate: string | null
}

export type AggregatedGroupRow = RawGroupRow & {
  accountIds: string[]
  accountUsernames: string[]
  accountCount: number
  latestAccountUsername: string
  canonicalKey: string
}

const normalizeKey = (value: string | null | undefined) => String(value || '').trim().toLowerCase()

const getCanonicalKey = (group: RawGroupRow) => {
  const id = String(group.id || '').trim()
  if (id) return `id:${id}`

  const username = normalizeKey(group.username)
  if (username) return `username:${username}`

  return `name:${normalizeKey(group.name)}`
}

const getDateMs = (value: string | null | undefined) => {
  if (!value) return 0
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

export function aggregateGroups(groups: RawGroupRow[]): AggregatedGroupRow[] {
  const aggregated = new Map<string, AggregatedGroupRow>()

  for (const group of groups || []) {
    const canonicalKey = getCanonicalKey(group)
    const existing = aggregated.get(canonicalKey)

    if (!existing) {
      aggregated.set(canonicalKey, {
        ...group,
        accountIds: group.accountId ? [group.accountId] : [],
        accountUsernames: group.accountUsername ? [group.accountUsername] : [],
        accountCount: group.accountId ? 1 : 0,
        latestAccountUsername: group.accountUsername || group.accountId || '',
        canonicalKey,
      })
      continue
    }

    const mergedAccountIds = new Set(existing.accountIds)
    const mergedAccountUsernames = new Set(existing.accountUsernames)
    if (group.accountId) mergedAccountIds.add(group.accountId)
    if (group.accountUsername) mergedAccountUsernames.add(group.accountUsername)

    const next = {
      ...existing,
      accountIds: Array.from(mergedAccountIds),
      accountUsernames: Array.from(mergedAccountUsernames),
      accountCount: Array.from(mergedAccountIds).length,
      canonicalKey,
    }

    if (getDateMs(group.lastMessageDate) >= getDateMs(existing.lastMessageDate)) {
      next.name = group.name || existing.name
      next.membersCount = group.membersCount ?? existing.membersCount
      next.type = group.type || existing.type
      next.username = group.username ?? existing.username
      next.lastMessage = group.lastMessage || existing.lastMessage
      next.lastMessageDate = group.lastMessageDate || existing.lastMessageDate
    }

    aggregated.set(canonicalKey, next)
  }

  return Array.from(aggregated.values()).sort((a, b) => {
    const dateDelta = getDateMs(b.lastMessageDate) - getDateMs(a.lastMessageDate)
    if (dateDelta !== 0) return dateDelta
    return a.name.localeCompare(b.name)
  })
}

export function formatAccountSummary(accountUsernames: string[]) {
  const values = Array.from(new Set((accountUsernames || []).map((value) => String(value || '').trim()).filter(Boolean)))
  if (values.length === 0) return ''
  if (values.length === 1) return values[0]
  return `${values[0]} +${values.length - 1}`
}
