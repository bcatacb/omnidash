import { useState } from "react";
import { FleetSnapshot } from "./FleetSnapshot";
import { ExpiryTracker } from "./ExpiryTracker";
import { StatusBreakdown } from "./StatusBreakdown";
import { GeoDistribution } from "./GeoDistribution";
import { GroupMembership } from "./GroupMembership";
import { SpendReport } from "./SpendReport";

const REPORTS = [
  { id: "fleet", label: "Fleet Snapshot", Component: FleetSnapshot },
  { id: "expiry", label: "Expiry Tracker", Component: ExpiryTracker },
  { id: "status", label: "Status Breakdown", Component: StatusBreakdown },
  { id: "geo", label: "Geographic", Component: GeoDistribution },
  { id: "groups", label: "Groups", Component: GroupMembership },
  { id: "spend", label: "Spend / Orders", Component: SpendReport },
] as const;

type ReportId = (typeof REPORTS)[number]["id"];

export function ReportsPage() {
  const [active, setActive] = useState<ReportId>("fleet");
  const report = REPORTS.find((r) => r.id === active)!;
  const { Component } = report;

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border bg-surface overflow-x-auto shrink-0">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              active === r.id
                ? "border-neon-cyan text-neon-cyan"
                : "border-transparent text-fg-muted hover:text-fg hover:border-border"
            }`}
            onClick={() => setActive(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        <Component />
      </div>
    </div>
  );
}
