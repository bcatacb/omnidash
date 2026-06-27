import { useQuery } from "@tanstack/react-query";
import { listOrders } from "../../api/account";

const params = { page: 1, pageSize: 50 };

export function OrdersPage() {
  const q = useQuery({
    queryKey: ["orders", params.page, params.pageSize],
    queryFn: () => listOrders(params),
  });

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Order History</h1>
      {q.isLoading && <p className="text-fg-muted">Loading orders…</p>}
      {q.isError && <p className="text-neon-red">Failed to load orders.</p>}
      {q.data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Order ID</th><th className="p-2">Product</th><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Total</th><th className="p-2">Created</th></tr>
          </thead>
          <tbody>
            {q.data.items.map((o) => (
              <tr key={o.order_id}>
                <td className="p-2 font-mono text-xs text-fg-muted">{o.order_id}</td>
                <td className="p-2">{o.product}</td>
                <td className="p-2">{o.type}</td>
                <td className="p-2">{o.status}</td>
                <td className="p-2">{o.total}</td>
                <td className="p-2 font-mono text-xs text-fg-muted">{o.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
