import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { buyPhones } from "../../api/provision";
import { getResources, getResolutions } from "../../api/reference";

// purchase os codes per the API inventory
const OS_OPTIONS = [
  { value: "10", label: "Android 10" },
  { value: "12A", label: "Android 12 (Region A)" },
  { value: "11", label: "Android 11" },
  { value: "15", label: "Android 15" },
  { value: "12B", label: "Android 12 (Region B)" },
];
const DURATIONS = [7, 30, 90, 180, 360];

export function ProvisionPage() {
  const [os, setOs] = useState("15");
  const [duration, setDuration] = useState(30);
  const [quantity, setQuantity] = useState(1);
  const [coupon, setCoupon] = useState("");

  const buy = useMutation({
    mutationFn: () => buyPhones({ os, duration, quantity, ...(coupon ? { coupon_code: coupon } : {}) }),
  });

  const resources = useQuery({ queryKey: ["reference", "resources"], queryFn: getResources });
  const resolutions = useQuery({ queryKey: ["reference", "resolutions"], queryFn: getResolutions });

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-semibold text-fg">Provision</h1>

      <section className="card p-4 space-y-3 max-w-md">
        <h2 className="text-sm font-semibold uppercase text-fg-dim">Buy cloud phones</h2>
        <label className="block text-sm text-fg-muted">
          OS
          <select className="select w-full mt-1" value={os}
            onChange={(e) => setOs(e.target.value)} aria-label="os">
            {OS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-sm text-fg-muted">
          Duration (days)
          <select className="select w-full mt-1" value={duration}
            onChange={(e) => setDuration(Number(e.target.value))} aria-label="duration">
            {DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="block text-sm text-fg-muted">
          Quantity
          <input type="number" min={1} className="input w-full mt-1" value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} aria-label="quantity" />
        </label>
        <label className="block text-sm text-fg-muted">
          Coupon (optional)
          <input className="input w-full mt-1" value={coupon}
            onChange={(e) => setCoupon(e.target.value)} aria-label="coupon" />
        </label>
        <div className="flex items-center gap-3">
          <button className="btn btn-green"
            disabled={buy.isPending} onClick={() => buy.mutate()}>Buy</button>
          {buy.isPending && <span className="text-sm text-fg-muted">Placing order…</span>}
          {buy.isError && <span className="text-sm text-neon-red">{(buy.error as Error).message}</span>}
          {buy.data && <span className="text-sm text-neon-green">Order: <span className="font-mono">{buy.data.order_id}</span></span>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase text-fg-dim">Reference data</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold text-fg-muted mb-1">Available resources</h3>
            {resources.isLoading && <p className="text-fg-muted text-sm">Loading…</p>}
            {resources.isError && <p className="text-neon-red text-sm">Failed to load resources.</p>}
            {resources.data && (
              <table className="table card">
                <thead>
                  <tr><th className="p-2">Region</th><th className="p-2">OS</th><th className="p-2">Available</th></tr>
                </thead>
                <tbody>
                  {resources.data.list.map((r) => (
                    <tr key={`${r.region_id}-${r.os}`}>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">{r.os}</td>
                      <td className="p-2 text-fg-muted">{`${r.count - r.used_count} / ${r.count}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-fg-muted mb-1">Resolutions</h3>
            {resolutions.isLoading && <p className="text-fg-muted text-sm">Loading…</p>}
            {resolutions.isError && <p className="text-neon-red text-sm">Failed to load resolutions.</p>}
            {resolutions.data && (
              <ul className="text-sm space-y-0.5">
                {resolutions.data.list.map((r) => <li key={r} className="font-mono text-fg-muted">{r}</li>)}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
