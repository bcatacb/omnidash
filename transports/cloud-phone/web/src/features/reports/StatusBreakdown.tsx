import { useMemo, useState } from "react";
import type { PhonePowerState } from "@duoplus/shared";
import { useAllPhones } from "./useAllPhones";
import { toCSV, downloadCSV } from "./csvExport";

const STATES: PhonePowerState[] = ["on", "off", "booting", "expired", "unknown"];

const BADGE: Record<string, string> = {
  on: "badge badge-on", off: "badge badge-off", booting: "badge badge-booting",
  expired: "badge badge-expired", unknown: "badge badge-unknown",
};

const CARD_COLOR: Record<string, string> = {
  on: "text-neon-green", off: "text-fg-muted", booting: "text-neon-amber",
  expired: "text-neon-red", unknown: "text-fg-muted",
};

export function StatusBreakdown() {
  const { data, isLoading, isError } = useAllPhones();
  const [filter, setFilter] = useState<PhonePowerState | "all">("all");

  const counts = useMemo(() => {
    if (!data) return {} as Record<PhonePowerState, number>;
    return STATES.reduce((acc, s) => {
      acc[s] = data.filter((p) => p.powerState === s).length;
      return acc;
    }, {} as Record<PhonePowerState, number>);
  }, [data]);

  const visible = useMemo(
    () => (data ?? []).filter((p) => filter === "all" || p.powerState === filter),
    [data, filter],
  );

  function exportCSV() {
    const headers = ["Name", "Status", "Area", "Group", "Expires"];
    const rows = visible.map((p) => [p.name, p.powerState, p.area, p.group, p.expiredAt]);
    downloadCSV(`status-${filter}.csv`, toCSV(headers, rows));
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-fg">Status Breakdown</h2>
        <button className="btn btn-ghost ml-auto" onClick={exportCSV} disabled={!data}>Export CSV</button>
      </div>

      {isLoading && <p className="text-fg-muted">Loading…</p>}
      {isError && <p className="text-neon-red">Failed to load fleet.</p>}

      {data && (
        <>
          <div className="flex flex-wrap gap-3">
            {STATES.map((s) => (
              <button key={s}
                className={`card p-4 flex flex-col items-center gap-1 cursor-pointer border-2 transition-colors ${
                  filter === s ? "border-neon-cyan" : "border-border hover:border-fg-muted"
                }`}
                onClick={() => setFilter((f) => (f === s ? "all" : s))}>
                <span className={`text-2xl font-bold ${CARD_COLOR[s]}`}>{counts[s] ?? 0}</span>
                <span className={`badge ${BADGE[s]}`}>{s}</span>
              </button>
            ))}
            {filter !== "all" && (
              <button className="card p-4 flex items-center text-fg-muted text-sm cursor-pointer hover:text-fg"
                onClick={() => setFilter("all")}>
                Clear filter
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="p-2">Name</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Area</th>
                  <th className="p-2">Group</th>
                  <th className="p-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td className="p-2 font-medium">{p.name}</td>
                    <td className="p-2"><span className={BADGE[p.powerState] ?? "badge badge-unknown"}>{p.powerState}</span></td>
                    <td className="p-2">{p.area || "—"}</td>
                    <td className="p-2 text-fg-muted">{p.group || "—"}</td>
                    <td className="p-2 text-xs text-fg-muted">{p.expiredAt ? p.expiredAt.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
