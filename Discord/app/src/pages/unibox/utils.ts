// Shared presentational helpers for the Unibox panes.

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?"
  const trimmed = name.trim()
  if (!trimmed) return "?"
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

// Stable hash so an account/peer gets the same accent across renders.
function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

const AVATAR_PALETTE = [
  "#5865F2", // brand
  "#23A55A", // green
  "#F0B232", // yellow
  "#EB459E", // pink
  "#9B59B6", // purple
  "#00A8FC", // link blue
  "#F23F43", // red
  "#1ABC9C", // teal
]

export function avatarColorFromId(id: string | null | undefined): string {
  if (!id) return AVATAR_PALETTE[0]!
  return AVATAR_PALETTE[hashString(id) % AVATAR_PALETTE.length]!
}

const RELATIVE_THRESHOLDS: Array<{ limit: number; div: number; unit: string }> = [
  { limit: 60_000, div: 1_000, unit: "s" },
  { limit: 3_600_000, div: 60_000, unit: "m" },
  { limit: 86_400_000, div: 3_600_000, unit: "h" },
  { limit: 7 * 86_400_000, div: 86_400_000, unit: "d" },
]

export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ""
  const diff = Math.max(0, nowMs - ts)
  if (diff < 5_000) return "now"
  for (const t of RELATIVE_THRESHOLDS) {
    if (diff < t.limit) {
      return `${Math.floor(diff / t.div)}${t.unit}`
    }
  }
  // Fallback to date
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function formatAbsoluteTime(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ""
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function isSameMinute(aIso: string, bIso: string): boolean {
  const a = Date.parse(aIso)
  const b = Date.parse(bIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return Math.abs(a - b) < 5 * 60_000
}
