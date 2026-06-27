import { useMemo, useState } from "react";
import { useAllPhones } from "./useAllPhones";
import { toCSV, downloadCSV } from "./csvExport";

const BADGE: Record<string, string> = {
  on: "badge badge-on", off: "badge badge-off", booting: "badge badge-booting",
  expired: "badge badge-expired", unknown: "badge badge-unknown",
};

export function GeoDistribution() {
  const { data, isLoading, isError } = useAllPhones();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, typeof data>();
    for (const p of data) {
      const key = p.area || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()]
      .map(([area, phones]) => ({ area, phones }))
      .sort((a, b) => b.phones.length - a.phones.length);
  }, [data]);

  function toggle(area: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area); else next.add(area);
      return next;
    });
  }

  function exportCSV() {
    const headers = ["Area", "Count", "Phone Name", "Status"];
    const rows = groups.flatMap(({ area, phones }) =>
      phones.map((p) => [area, phones.length, p.name, p.powerState]),
    );
    downloadCSV("geo-distribution.csv", toCSV(headers, rows));
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-fg">Geographic Distribution</h2>
        <span className="text-fg-muted text-sm">{groups.length} regions</span>
        <button className="btn btn-ghost ml-auto" onClick={exportCSV} disabled={!data}>Export CSV</button>
      </div>
      {isLoading && <p className="text-fg-muted">Loading…</p>}
      {isError && <p className="text-neon-red">Failed to load fleet.</p>}
      {data && (
        <div className="space-y-2">
          {groups.map(({ area, phones }) => (
            <div key={area} className="card overflow-hidden">
              <button
                className="w-full flex items-center gap-3 p-3 hover:bg-surface-hover text-left"
                onClick={() => toggle(area)}>
                <span className="font-semibold text-neon-cyan">{area}</span>
                <span className="text-fg-muted text-sm">{phones.length} phone{phones.length !== 1 ? "s" : ""}</span>
                <span className="ml-auto text-fg-muted text-sm">{expanded.has(area) ? "▲" : "▼"}</span>
              </button>
              {expanded.has(area) && (
                <table className="table border-t border-border">
                  <thead>
                    <tr>
                      <th className="p-2">Name</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Group</th>
                      <th className="p-2">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phones.map((p) => (
                      <tr key={p.id}>
                        <td className="p-2 font-medium">{p.name}</td>
                        <td className="p-2"><span className={BADGE[p.powerState] ?? "badge badge-unknown"}>{p.powerState}</span></td>
                        <td className="p-2 text-fg-muted">{p.group || "—"}</td>
                        <td className="p-2 font-mono text-xs text-fg-muted">{p.ip || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
