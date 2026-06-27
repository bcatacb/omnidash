import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listGroups, createGroups, updateGroups, deleteGroups,
  type GroupWithCount,
} from "../../api/groups";

const params = { page: 1 };
const groupsKey = ["groups", params.page] as const;

function useGroups() {
  return useQuery({ queryKey: groupsKey, queryFn: () => listGroups(params) });
}

export function GroupsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useGroups();
  const [result, setResult] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: groupsKey });

  const create = useMutation({
    mutationFn: (g: { name: string; sort?: number; remark?: string }) => createGroups([g]),
    onSuccess: (r) => { setResult(`Created ${r.success.length}, failed ${r.fail.length}`); invalidate(); },
  });
  const edit = useMutation({
    mutationFn: (g: { id: string; name: string; sort?: number; remark?: string }) => updateGroups([g]),
    onSuccess: (r) => { setResult(`Updated ${r.success.length}, failed ${r.fail.length}`); setEditing(null); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteGroups([id]),
    onSuccess: (r) => { setResult(`Deleted ${r.success.length}, failed ${r.fail.length}`); invalidate(); },
  });

  const [form, setForm] = useState({ name: "", sort: "0", remark: "" });
  const [editing, setEditing] = useState<GroupWithCount | null>(null);

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;
    create.mutate({ name: form.name, sort: Number(form.sort) || 0, remark: form.remark || undefined });
    setForm({ name: "", sort: "0", remark: "" });
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Groups</h1>

      <form onSubmit={submitCreate} className="card p-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-fg-muted">Name
          <input className="input mt-1" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Group name" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Sort
          <input className="input mt-1 w-16" value={form.sort}
            onChange={(e) => setForm({ ...form, sort: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Remark
          <input className="input mt-1" value={form.remark}
            onChange={(e) => setForm({ ...form, remark: e.target.value })} />
        </label>
        <button type="submit" className="btn btn-green"
          disabled={create.isPending}>Create group</button>
      </form>

      {result && <p className="text-sm text-fg-muted">{result}</p>}

      {isLoading && <p className="text-fg-muted">Loading groups…</p>}
      {isError && <p className="text-neon-red">Failed to load groups.</p>}

      {data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Name</th><th className="p-2">Sort</th><th className="p-2">Remark</th><th className="p-2">Phones</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.id}>
                <td className="p-2">{g.name}</td>
                <td className="p-2">{g.sort}</td>
                <td className="p-2">{g.remark}</td>
                <td className="p-2">{g.image_count ?? "—"}</td>
                <td className="p-2 space-x-2">
                  <button className="text-neon-amber" onClick={() => setEditing(g)} aria-label={`edit ${g.id}`}>Edit</button>
                  <button className="text-neon-red disabled:opacity-40" disabled={del.isPending}
                    onClick={() => del.mutate(g.id)} aria-label={`delete ${g.id}`}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-label="edit group">
          <form
            className="card p-4 space-y-2 w-80"
            onSubmit={(e) => { e.preventDefault(); edit.mutate({ id: editing.id, name: editing.name, sort: editing.sort, remark: editing.remark }); }}
          >
            <h2 className="font-semibold text-fg">Edit group</h2>
            <label className="flex flex-col text-xs text-fg-muted">Name
              <input className="input mt-1" value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label className="flex flex-col text-xs text-fg-muted">Sort
              <input className="input mt-1" value={editing.sort}
                onChange={(e) => setEditing({ ...editing, sort: Number(e.target.value) })} />
            </label>
            <label className="flex flex-col text-xs text-fg-muted">Remark
              <input className="input mt-1" value={editing.remark}
                onChange={(e) => setEditing({ ...editing, remark: e.target.value })} />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-cyan" disabled={edit.isPending}>Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
