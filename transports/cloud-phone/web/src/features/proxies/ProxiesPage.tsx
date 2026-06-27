import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Proxy } from "@duoplus/shared";
import {
  listProxies, addProxies, deleteProxies, refreshProxies, updateProxy,
  type ProxyAddItem,
} from "../../api/proxies";

const params = { page: 1, pageSize: 50 };
const proxiesKey = ["proxies", params.page, params.pageSize] as const;

function useProxies() {
  return useQuery({ queryKey: proxiesKey, queryFn: () => listProxies(params) });
}

export function ProxiesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useProxies();
  const [result, setResult] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: proxiesKey });

  const add = useMutation({
    mutationFn: (item: ProxyAddItem) => addProxies([item]),
    onSuccess: (r) => { setResult(`Added ${r.success.length}, failed ${r.fail.length}`); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteProxies([id]),
    onSuccess: (r) => { setResult(`Deleted ${r.success.length}, failed ${r.fail.length}`); invalidate(); },
  });
  const refresh = useMutation({
    mutationFn: (id: string) => refreshProxies([id]),
    onSuccess: (r) => { setResult(`Refreshed ${r.success.length}, failed ${r.fail.length}`); invalidate(); },
  });
  const modify = useMutation({
    mutationFn: (b: { id: string; host?: string; port?: number; user?: string; password?: string; name?: string }) => updateProxy(b),
    onSuccess: (r) => { setResult(r.message); setEditing(null); invalidate(); },
  });

  const [form, setForm] = useState({ protocol: "socks5", host: "", port: "1080", user: "", password: "", name: "" });
  const [editing, setEditing] = useState<Proxy | null>(null);

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.host || !form.port) return;
    add.mutate({
      protocol: form.protocol, host: form.host, port: Number(form.port),
      user: form.user || undefined, password: form.password || undefined, name: form.name || undefined,
    });
    setForm({ protocol: "socks5", host: "", port: "1080", user: "", password: "", name: "" });
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Proxies</h1>

      <form onSubmit={submitAdd} className="card p-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-fg-muted">Protocol
          <select className="select mt-1" value={form.protocol}
            onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
            <option value="socks5">socks5</option>
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Host
          <input className="input mt-1" value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="1.2.3.4" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Port
          <input className="input mt-1 w-20" value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="1080" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">User
          <input className="input mt-1" value={form.user}
            onChange={(e) => setForm({ ...form, user: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Password
          <input className="input mt-1" type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Name
          <input className="input mt-1" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-green"
          disabled={add.isPending}>Add proxy</button>
      </form>

      {result && <p className="text-sm text-fg-muted">{result}</p>}

      {isLoading && <p className="text-fg-muted">Loading proxies…</p>}
      {isError && <p className="text-neon-red">Failed to load proxies.</p>}

      {data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Name</th><th className="p-2">Host:Port</th><th className="p-2">Area</th><th className="p-2">User</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td className="p-2">{p.name}</td>
                <td className="p-2">{p.host}:{p.port}</td>
                <td className="p-2 text-fg-muted">{p.area}</td>
                <td className="p-2 text-fg-muted">{p.user}</td>
                <td className="p-2 space-x-2">
                  <button className="text-neon-cyan disabled:opacity-40" disabled={refresh.isPending}
                    onClick={() => refresh.mutate(p.id)} aria-label={`refresh ${p.id}`}>Refresh</button>
                  <button className="text-neon-amber" onClick={() => setEditing(p)} aria-label={`modify ${p.id}`}>Modify</button>
                  <button className="text-neon-red disabled:opacity-40" disabled={del.isPending}
                    onClick={() => del.mutate(p.id)} aria-label={`delete ${p.id}`}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-label="modify proxy">
          <form
            className="card p-4 space-y-2 w-80"
            onSubmit={(e) => {
              e.preventDefault();
              modify.mutate({ id: editing.id, name: editing.name, host: editing.host, port: editing.port, user: editing.user });
            }}
          >
            <h2 className="font-semibold text-fg">Modify proxy</h2>
            <label className="flex flex-col text-xs text-fg-muted">Name
              <input className="input mt-1" value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label className="flex flex-col text-xs text-fg-muted">Host
              <input className="input mt-1" value={editing.host}
                onChange={(e) => setEditing({ ...editing, host: e.target.value })} />
            </label>
            <label className="flex flex-col text-xs text-fg-muted">Port
              <input className="input mt-1" value={editing.port}
                onChange={(e) => setEditing({ ...editing, port: Number(e.target.value) })} />
            </label>
            <label className="flex flex-col text-xs text-fg-muted">User
              <input className="input mt-1" value={editing.user}
                onChange={(e) => setEditing({ ...editing, user: e.target.value })} />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-cyan" disabled={modify.isPending}>Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
