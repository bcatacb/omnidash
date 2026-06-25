import { useMemo, useState } from "react"

interface Props { value: string[]; onChange: (next: string[]) => void; disabled?: boolean; label?: string }

function expandPreview(tpl: string, salt: string): string {
  let out = "", i = 0, counter = 0
  while (i < tpl.length) {
    const ch = tpl[i]
    if (ch === "{") {
      let depth = 0, close = -1
      for (let j = i; j < tpl.length; j++) {
        if (tpl[j] === "{") depth++; else if (tpl[j] === "}") { depth--; if (depth === 0) { close = j; break } }
      }
      if (close < 0) { out += tpl.slice(i); break }
      const inner = tpl.slice(i + 1, close)
      const opts: string[] = []
      let d = 0, start = 0
      for (let j = 0; j < inner.length; j++) {
        if (inner[j] === "{") d++; else if (inner[j] === "}") d--
        else if (inner[j] === "|" && d === 0) { opts.push(inner.slice(start, j)); start = j + 1 }
      }
      opts.push(inner.slice(start))
      let h = 0
      for (const c of `${salt}:${counter}`) h = (h * 31 + c.charCodeAt(0)) | 0
      const pick = opts[((h % opts.length) + opts.length) % opts.length] || ""
      out += expandPreview(pick, `${salt}:${counter}`); counter++; i = close + 1
    } else { out += ch; i++ }
  }
  return out
}

export default function MessageBankEditor({ value, onChange, disabled, label }: Props) {
  const [text, setText] = useState(value.join("\n"))
  const previews = useMemo(() => {
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean)
    return lines.slice(0, 8).map((line, i) => expandPreview(line, `preview-${i}-${Date.now() / 60000 | 0}`))
  }, [text])
  return (
    <div>
      {label && <label className="text-[11px] font-medium text-text-muted">{label}</label>}
      <textarea value={text}
        onChange={(e) => { setText(e.target.value); onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)) }}
        disabled={disabled} rows={6}
        placeholder={"One spintax template per line, e.g.\n{Hey|Yo|Sup} {there|friend}\n{how's it going|what's up|long time}"}
        className="mt-1 block w-full rounded-md border border-bg-tertiary bg-bg-tertiary/50 px-2 py-1.5 font-mono text-[11px] text-text-normal" />
      {previews.length > 0 && (
        <details className="mt-1 text-[10px] text-text-muted">
          <summary className="cursor-pointer">preview</summary>
          <ul className="mt-1 ml-3 list-disc">{previews.map((p, i) => <li key={i} className="break-all">{p}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
