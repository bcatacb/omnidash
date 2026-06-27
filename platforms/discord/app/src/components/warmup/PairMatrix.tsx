import { useMemo } from "react"

export interface PairMatrixAccount {
  id: string; username: string; proxyId: string | null
}

interface Props {
  accounts: PairMatrixAccount[]
  pairs: Set<string>
  onTogglePair: (a: string, b: string) => void
  onToggleRow?: (accountId: string) => void  // bulk-pair every cross-proxy partner for this account
  disabled?: boolean
}

export default function PairMatrix({ accounts, pairs, onTogglePair, onToggleRow, disabled }: Props) {
  const sorted = useMemo(() => [...accounts].sort((a, b) => a.id.localeCompare(b.id)), [accounts])
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  return (
    <div className="overflow-auto rounded border border-bg-tertiary">
      <table className="text-[11px] font-mono">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-bg-secondary border-b border-r border-bg-tertiary px-2 py-1 text-left text-text-muted">account</th>
            {sorted.map((a) => (
              <th key={a.id} className="border-b border-bg-tertiary px-1 py-1 whitespace-nowrap text-text-muted" title={a.id}>@{a.username.slice(0, 10)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id}>
              <th className="sticky left-0 z-10 bg-bg-secondary border-r border-bg-tertiary px-2 py-1 text-left whitespace-nowrap" title={onToggleRow ? `click to pair all cross-proxy partners for ${row.id}` : row.id}>
                {onToggleRow ? (
                  <button type="button" disabled={disabled} onClick={() => onToggleRow(row.id)} className="text-text-muted hover:text-text-normal hover:underline">@{row.username.slice(0, 14)}</button>
                ) : (
                  <span className="text-text-muted">@{row.username.slice(0, 14)}</span>
                )}
              </th>
              {sorted.map((col) => {
                if (row.id === col.id) return <td key={col.id} className="bg-bg-tertiary/40 px-2 py-1 text-center text-text-muted">—</td>
                const sameProxy = row.proxyId && col.proxyId && row.proxyId === col.proxyId
                const isPaired = pairs.has(key(row.id, col.id))
                if (sameProxy) return <td key={col.id} className="px-1 py-1 text-center bg-rose-500/20 cursor-not-allowed" title="same proxy">×</td>
                return (
                  <td key={col.id} className="px-1 py-1 text-center">
                    <button type="button" disabled={disabled} onClick={() => onTogglePair(row.id, col.id)}
                      className={`h-5 w-5 rounded-sm transition-colors ${isPaired ? "bg-emerald-500 hover:bg-emerald-600" : "bg-bg-tertiary hover:bg-bg-message-hover"}`}
                      aria-label={isPaired ? "remove pair" : "add pair"} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
