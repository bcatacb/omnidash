import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listOrders } from "../../api/account";
import { toCSV, downloadCSV } from "./csvExport";

export function SpendReport() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["orders", 1, 200],
    queryFn: () => listOrders({ page: 1, pageSize: 200 }),
    staleTime: 60_000,
  });

  const orders = data?.items ?? [];

  const totalSpend = useMemo(() => {
    return orders.reduce((sum, o) => {
      const n = parseFloat(o.total);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
  }, [orders]);

  function exportCSV() {
    const headers = ["Order ID", "Product", "Type", "Status", "Total", "Created", "Expires"];
    const rows = orders.map((o) => [o.order_id, o.product, o.type, o.status, o.total, o.created_at, o.expired_at]);
    downloadCSV("spend-report.csv", toCSV(headers, rows));
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-fg">Spend / Orders</h2>
        {data && (
          <>
            <span className="text-fg-muted text-sm">{orders.length} orders</span>
            <span className="text-neon-green font-semibold">Total: {totalSpend.toFixed(2)}</span>
          </>
        )}
        <button className="btn btn-ghost ml-auto" onClick={exportCSV} disabled={!data}>Export CSV</button>
      </div>
      {isLoading && <p className="text-fg-muted">Loading orders…</p>}
      {isError && <p className="text-neon-red">Failed to load orders.</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="p-2">Order ID</th>
                <th className="p-2">Product</th>
                <th className="p-2">Type</th>
                <th className="p-2">Status</th>
                <th className="p-2">Total</th>
                <th className="p-2">Created</th>
                <th className="p-2">Expires</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id}>
                  <td className="p-2 font-mono text-xs text-fg-muted">{o.order_id}</td>
                  <td className="p-2">{o.product}</td>
                  <td className="p-2 text-fg-muted">{o.type}</td>
                  <td className="p-2">{o.status}</td>
                  <td className="p-2 text-neon-green font-medium">{o.total}</td>
                  <td className="p-2 text-xs text-fg-muted">{o.created_at ? o.created_at.slice(0, 10) : "—"}</td>
                  <td className="p-2 text-xs text-fg-muted">{o.expired_at ? o.expired_at.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
