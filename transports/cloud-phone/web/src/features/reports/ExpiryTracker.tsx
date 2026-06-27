import { useMemo } from "react";
import type { CloudPhone } from "@duoplus/shared";
import { useAllPhones } from "./useAllPhones";
import { toCSV, downloadCSV } from "./csvExport";

function daysLeft(expiredAt: string): number {
  return Math.ceil((new Date(expiredAt).getTime() - Date.now()) / 86_400_000);
}

function urgencyClass(days: number): string {
  if (days < 7) return "text-neon-red font-semibold";
  if (days < 30) return "text-neon-amber";
  return "text-neon-green";
}

function urgencyLabel(days: number): string {
  if (days < 0) return "Expired";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function ExpiryTracker() {
  const { data, isLoading, isError } = useAllPhones();

  const phones = useMemo(() => {
    if (!data) return [];
    return [...data]
      .filter((p) => p.expiredAt)
      .map((p) => ({ ...p, days: daysLeft(p.expiredAt) }))
      .sort((a, b) => a.days - b.days);
  }, [data]);

  function exportCSV() {
    const headers = ["Name", "Status", "Area", "Group", "Days Left", "Expires"];
    const rows = phones.map((p) => [p.name, p.powerState, p.area, p.group, p.days, p.expiredAt]);
    downloadCSV("expiry-tracker.csv", toCSV(headers, rows));
  }

  const urgent = phones.filter((p) => p.days < 7).length;
  const warning = phones.filter((p) => p.days >= 7 && p.days < 30).length;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-fg">Expiry Tracker</h2>
        {urgent > 0 && <span className="badge badge-expired">{urgent} critical (&lt;7 days)</span>}
        {warning > 0 && <span className="text-neon-amber text-sm">{warning} expiring soon</span>}
        <button className="btn btn-ghost ml-auto" onClick={exportCSV} disabled={!data}>Export CSV</button>
      </div>
      {isLoading && <p className="text-fg-muted">Loading…</p>}
      {isError && <p className="text-neon-red">Failed to load fleet.</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="p-2">Name</th>
                <th className="p-2">Status</th>
                <th className="p-2">Area</th>
                <th className="p-2">Group</th>
                <th className="p-2">Days Left</th>
                <th className="p-2">Expires</th>
              </tr>
            </thead>
            <tbody>
              {phones.map((p) => (
                <tr key={p.id}>
                  <td className="p-2 font-medium">{p.name}</td>
                  <td className="p-2">
                    <span className={`badge badge-${p.powerState}`}>{p.powerState}</span>
                  </td>
                  <td className="p-2">{p.area || "—"}</td>
                  <td className="p-2 text-fg-muted">{p.group || "—"}</td>
                  <td className={`p-2 ${urgencyClass(p.days)}`}>{urgencyLabel(p.days)}</td>
                  <td className="p-2 text-xs text-fg-muted">{p.expiredAt ? p.expiredAt.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
