import { useState } from "react";
import type { CloudPhone, PhonePowerState } from "@duoplus/shared";
import { usePhones } from "./useFleet";
import { FleetGrid } from "./FleetGrid";
import { BatchActionBar } from "./BatchActionBar";
import { DeviceDrawer } from "../device/DeviceDrawer";
import { useFleetStore } from "../../store/fleetStore";

const STATUS_OPTIONS: Array<PhonePowerState | "all"> = ["all", "on", "off", "booting", "expired", "unknown"];
const PAGE_SIZES = [20, 50, 100];

function matchesSearch(p: CloudPhone, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    p.name.toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q) ||
    (p.area ?? "").toLowerCase().includes(q)
  );
}

export function FleetPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const params = { page, pageSize };
  const { data, isLoading, isError } = usePhones(params);
  const [openId, setOpenId] = useState<string | null>(null);

  const search = useFleetStore((s) => s.search);
  const setSearch = useFleetStore((s) => s.setSearch);
  const statusFilter = useFleetStore((s) => s.statusFilter);
  const setStatusFilter = useFleetStore((s) => s.setStatusFilter);

  const items = data?.items ?? [];
  const visible = items.filter(
    (p) => matchesSearch(p, search) && (statusFilter === "all" || p.powerState === statusFilter),
  );
  const openPhone = items.find((p) => p.id === openId) ?? null;

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <BatchActionBar params={params} />

      <div className="flex flex-wrap items-end gap-2 p-2 border-b border-border bg-surface">
        <label className="flex flex-col text-xs text-fg-muted">Search
          <input className="input mt-1" value={search}
            onChange={(e) => setSearch(e.target.value)} placeholder="name, id, area" aria-label="search fleet" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Status
          <select className="select mt-1" value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PhonePowerState | "all")} aria-label="status filter">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Page size
          <select className="select mt-1" value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="page size">
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <span className="ml-auto flex items-center gap-2 text-sm">
          <button className="btn btn-ghost"
            disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
          <span className="text-fg-muted">page {page} of {pageCount}</span>
          <button className="btn btn-ghost"
            disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
        </span>
      </div>

      {isLoading && <p className="p-4 text-fg-muted">Loading fleet…</p>}
      {isError && <p className="p-4 text-neon-red">Failed to load fleet.</p>}
      {data && <FleetGrid phones={visible} onOpen={setOpenId} />}
      {openPhone && <DeviceDrawer phone={openPhone} onClose={() => setOpenId(null)} />}
    </div>
  );
}
