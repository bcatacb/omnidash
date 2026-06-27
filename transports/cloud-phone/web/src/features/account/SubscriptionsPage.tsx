import { useQuery } from "@tanstack/react-query";
import { listSubscriptions } from "../../api/account";

const params = { page: 1, pageSize: 50 };

export function SubscriptionsPage() {
  const q = useQuery({
    queryKey: ["subscriptions", params.page, params.pageSize],
    queryFn: () => listSubscriptions(params),
  });

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Subscriptions</h1>
      {q.isLoading && <p className="text-fg-muted">Loading subscriptions…</p>}
      {q.isError && <p className="text-neon-red">Failed to load subscriptions.</p>}
      {q.data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Name</th><th className="p-2">CPU</th><th className="p-2">RAM</th><th className="p-2">ROM</th><th className="p-2">Renewal</th><th className="p-2">Expires</th></tr>
          </thead>
          <tbody>
            {q.data.items.map((s) => (
              <tr key={s.id}>
                <td className="p-2 font-medium">{s.name}</td>
                <td className="p-2">{s.cpu}</td>
                <td className="p-2">{s.ram}</td>
                <td className="p-2">{s.rom}</td>
                <td className="p-2">{s.renewal_status === 1 ? "Auto" : "Off"}{s.need_renewal ? " (due)" : ""}</td>
                <td className="p-2 font-mono text-xs text-fg-muted">{s.expired_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
