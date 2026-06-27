import { useMemo, useState } from "react";
import type { CloudPhone } from "@duoplus/shared";
import { useAllPhones } from "./useAllPhones";
import { toCSV, downloadCSV } from "./csvExport";

type SortKey = "name" | "powerState" | "os" | "size" | "area" | "group" | "ip" | "createdAt" | "expiredAt";
type Dir = "asc" | "desc";

const BADGE: Record<string, string> = {
  on: "badge badge-on", off: "badge badge-off", booting: "badge badge-booting",
  expired: "badge badge-expired", unknown: "badge badge-unknown",
};

function Th({ label, k, sortKey, sortDir, onSort }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: Dir; onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="p-2 whitespace-nowrap cursor-pointer select-none hover:text-neon-cyan"
      onClick={() => onSort(k)}>
      {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

function sorted(items: CloudPhone[], key: SortKey, dir: Dir) {
  return [...items].sort((a, b) => {
    const av = a[key] ?? ""; const bv = b[key] ?? "";
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return dir === "asc" ? cmp : -cmp;
  });
}

export function FleetSnapshot() {
  const { data, isLoading, isError } = useAllPhones();
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<Dir>("asc");

  const phones = useMemo(() => sorted(data ?? [], sortKey, sortDir), [data, sortKey, sortDir]);

  function onSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  function exportCSV() {
    const headers = ["Name", "Status", "Model", "OS", "Area", "Group", "IP", "ADB", "Created", "Expires"];
    const rows = phones.map((p) => [p.name, p.powerState, p.size, p.os, p.area, p.group, p.ip, p.adb, p.createdAt, p.expiredAt]);
    downloadCSV("fleet-snapshot.csv", toCSV(headers, rows));
  }

  const thProps = { sortKey, sortDir, onSort };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-fg">Fleet Snapshot</h2>
        <span className="text-fg-muted text-sm">{phones.length} phones</span>
        <button className="btn btn-ghost ml-auto" onClick={exportCSV} disabled={!data}>Export CSV</button>
      </div>
      {isLoading && <p className="text-fg-muted">Loading…</p>}
      {isError && <p className="text-neon-red">Failed to load fleet.</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <Th label="Name" k="name" {...thProps} />
                <Th label="Status" k="powerState" {...thProps} />
                <Th label="Model" k="size" {...thProps} />
                <Th label="OS" k="os" {...thProps} />
                <Th label="Area" k="area" {...thProps} />
                <Th label="Group" k="group" {...thProps} />
                <Th label="IP" k="ip" {...thProps} />
                <th className="p-2">ADB</th>
                <Th label="Created" k="createdAt" {...thProps} />
                <Th label="Expires" k="expiredAt" {...thProps} />
              </tr>
            </thead>
            <tbody>
              {phones.map((p) => (
                <tr key={p.id}>
                  <td className="p-2 font-medium">{p.name}</td>
                  <td className="p-2"><span className={BADGE[p.powerState] ?? "badge badge-unknown"}>{p.powerState}</span></td>
                  <td className="p-2 text-fg-muted">{p.size || "—"}</td>
                  <td className="p-2 text-fg-muted">{p.os || "—"}</td>
                  <td className="p-2">{p.area || "—"}</td>
                  <td className="p-2 text-fg-muted">{p.group || "—"}</td>
                  <td className="p-2 font-mono text-xs text-fg-muted">{p.ip || "—"}</td>
                  <td className="p-2 font-mono text-xs text-fg-muted">{p.adb || "—"}</td>
                  <td className="p-2 text-xs text-fg-muted">{p.createdAt ? p.createdAt.slice(0, 10) : "—"}</td>
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
