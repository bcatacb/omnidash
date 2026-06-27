import { useMemo, useState } from "react";
import { useAllPhones } from "./useAllPhones";
import { toCSV, downloadCSV } from "./csvExport";

const BADGE: Record<string, string> = {
  on: "badge badge-on", off: "badge badge-off", booting: "badge badge-booting",
  expired: "badge badge-expired", unknown: "badge badge-unknown",
};

export function GroupMembership() {
  const { data, isLoading, isError } = useAllPhones();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, typeof data>();
    for (const p of data) {
      const key = p.group || "Ungrouped";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()]
      .map(([group, phones]) => ({ group, phones }))
      .sort((a, b) => {
        if (a.group === "Ungrouped") return 1;
        if (b.group === "Ungrouped") return -1;
        return b.phones.length - a.phones.length;
      });
  }, [data]);

  function toggle(group: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }

  function exportCSV() {
    const headers = ["Group", "Count", "Phone Name", "Status", "Area"];
    const rows = groups.flatMap(({ group, phones }) =>
      phones.map((p) => [group, phones.length, p.name, p.powerState, p.area]),
    );
    downloadCSV("group-membership.csv", toCSV(headers, rows));
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-fg">Group Membership</h2>
        <span className="text-fg-muted text-sm">{groups.length} groups</span>
        <button className="btn btn-ghost ml-auto" onClick={exportCSV} disabled={!data}>Export CSV</button>
      </div>
      {isLoading && <p className="text-fg-muted">Loading…</p>}
      {isError && <p className="text-neon-red">Failed to load fleet.</p>}
      {data && (
        <div className="space-y-2">
          {groups.map(({ group, phones }) => (
            <div key={group} className="card overflow-hidden">
              <button
                className="w-full flex items-center gap-3 p-3 hover:bg-surface-hover text-left"
                onClick={() => toggle(group)}>
                <span className={`font-semibold ${group === "Ungrouped" ? "text-fg-muted" : "text-neon-purple"}`}>
                  {group}
                </span>
                <span className="text-fg-muted text-sm">{phones.length} phone{phones.length !== 1 ? "s" : ""}</span>
                <span className="ml-auto text-fg-muted text-sm">{expanded.has(group) ? "▲" : "▼"}</span>
              </button>
              {expanded.has(group) && (
                <table className="table border-t border-border">
                  <thead>
                    <tr>
                      <th className="p-2">Name</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Area</th>
                      <th className="p-2">Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phones.map((p) => (
                      <tr key={p.id}>
                        <td className="p-2 font-medium">{p.name}</td>
                        <td className="p-2"><span className={BADGE[p.powerState] ?? "badge badge-unknown"}>{p.powerState}</span></td>
                        <td className="p-2">{p.area || "—"}</td>
                        <td className="p-2 text-xs text-fg-muted">{p.expiredAt ? p.expiredAt.slice(0, 10) : "—"}</td>
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
