import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CloudNumber } from "@duoplus/shared";
import { listNumbers, listSms } from "../../api/numbers";

const params = { page: 1, pageSize: 50 };

export function NumbersPage() {
  const q = useQuery({
    queryKey: ["numbers", params.page, params.pageSize],
    queryFn: () => listNumbers(params),
  });
  const [selected, setSelected] = useState<CloudNumber | null>(null);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Cloud Numbers</h1>
      {q.isLoading && <p className="text-fg-muted">Loading numbers…</p>}
      {q.isError && <p className="text-neon-red">Failed to load numbers.</p>}
      {q.data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Number</th><th className="p-2">Region</th><th className="p-2">Type</th><th className="p-2">Status</th><th className="p-2">Expires</th></tr>
          </thead>
          <tbody>
            {q.data.items.map((n) => (
              <tr key={n.id} className="cursor-pointer" onClick={() => setSelected(n)}>
                <td className="p-2 font-medium text-neon-cyan">
                  <button className="hover:underline" aria-label={`view sms ${n.id}`}>{n.phone_number}</button>
                </td>
                <td className="p-2">{n.region_name}</td>
                <td className="p-2">{n.type_name}</td>
                <td className="p-2">{n.status_name}</td>
                <td className="p-2 font-mono text-xs text-fg-muted">{n.expired_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && <SmsDrawer number={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SmsDrawer({ number, onClose }: { number: CloudNumber; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["numbers", "sms", number.id],
    queryFn: () => listSms({ id: number.id, page: 1, pageSize: 50 }),
  });
  return (
    <div className="drawer fixed inset-y-0 right-0 w-96 p-4 overflow-y-auto" role="dialog" aria-label="sms messages">
      <button className="btn btn-ghost text-xs" onClick={onClose}>Close</button>
      <h2 className="text-lg font-semibold my-2 text-fg">{number.phone_number}</h2>
      {q.isLoading && <p className="text-fg-muted">Loading messages…</p>}
      {q.isError && <p className="text-neon-red">Failed to load messages.</p>}
      {q.data && (
        q.data.items.length === 0
          ? <p className="text-fg-dim text-sm">No messages.</p>
          : (
            <table className="table card text-xs">
              <thead>
                <tr><th className="p-1">Message</th><th className="p-1">Code</th><th className="p-1">Received</th></tr>
              </thead>
              <tbody>
                {q.data.items.map((m, i) => (
                  <tr key={i}>
                    <td className="p-1 break-all">{m.message}</td>
                    <td className="p-1 font-mono font-semibold text-neon-green">{m.code || "—"}</td>
                    <td className="p-1 font-mono text-fg-muted">{m.received_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}
    </div>
  );
}
