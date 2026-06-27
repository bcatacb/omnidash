import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ScheduledTask } from "@duoplus/shared";
import {
  listTemplates, listScheduled, listLoop,
  createLoop, setLoopStatus, deleteLoop,
  getReport, setScheduledStatus,
} from "../../api/automation";

const params = { page: 1, pageSize: 50 };
type Tab = "templates" | "scheduled" | "loop";

export function AutomationPage() {
  const [tab, setTab] = useState<Tab>("templates");
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Automation</h1>
      <div className="flex gap-2 border-b border-border">
        <button className={`px-3 py-2 text-sm ${tab === "templates" ? "border-b-2 border-accent text-accent font-semibold" : "text-fg-muted"}`}
          onClick={() => setTab("templates")}>Templates</button>
        <button className={`px-3 py-2 text-sm ${tab === "scheduled" ? "border-b-2 border-accent text-accent font-semibold" : "text-fg-muted"}`}
          onClick={() => setTab("scheduled")}>Scheduled</button>
        <button className={`px-3 py-2 text-sm ${tab === "loop" ? "border-b-2 border-accent text-accent font-semibold" : "text-fg-muted"}`}
          onClick={() => setTab("loop")}>Loop</button>
      </div>
      {tab === "templates" && <TemplatesTab />}
      {tab === "scheduled" && <ScheduledTab />}
      {tab === "loop" && <LoopTab />}
    </div>
  );
}

function TemplatesTab() {
  const [type, setType] = useState<"custom" | "official">("custom");
  const q = useQuery({
    queryKey: ["automation", "templates", type, params.page, params.pageSize],
    queryFn: () => listTemplates({ type, page: params.page, pageSize: params.pageSize }),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className={`${type === "custom" ? "btn btn-cyan" : "btn btn-ghost"}`}
          onClick={() => setType("custom")}>Custom</button>
        <button className={`${type === "official" ? "btn btn-cyan" : "btn btn-ghost"}`}
          onClick={() => setType("official")}>Official</button>
      </div>
      {q.isLoading && <p className="text-fg-muted">Loading templates…</p>}
      {q.isError && <p className="text-neon-red">Failed to load templates.</p>}
      {q.data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Name</th><th className="p-2">Description</th></tr>
          </thead>
          <tbody>
            {q.data.items.map((t) => (
              <tr key={t.id}>
                <td className="p-2">{t.name}</td>
                <td className="p-2 text-fg-muted">{t.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ScheduledTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["automation", "scheduled", params.page, params.pageSize],
    queryFn: () => listScheduled({ page: params.page, pageSize: params.pageSize }),
  });
  const [result, setResult] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<ScheduledTask | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["automation", "scheduled"] });

  const status = useMutation({
    mutationFn: (b: { ids: string[]; status: number }) => setScheduledStatus(b),
    onSuccess: (r) => { setResult(`Updated ${r.success.length}, failed ${r.fail.length}`); invalidate(); },
    onError: (e) => setResult(`Failed: ${(e as Error).message}`),
  });

  return (
    <div className="space-y-3">
      {result && <p className="text-sm text-fg-muted">{result}</p>}
      {q.isLoading && <p className="text-fg-muted">Loading scheduled tasks…</p>}
      {q.isError && <p className="text-neon-red">Failed to load scheduled tasks.</p>}
      {q.data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Name</th><th className="p-2">Type</th><th className="p-2">Phone</th><th className="p-2">Status</th><th className="p-2">Issue at</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {q.data.items.map((t) => (
              <tr key={t.id}>
                <td className="p-2">{t.name}</td>
                <td className="p-2">{t.task_type_name}</td>
                <td className="p-2">{t.image_name}</td>
                <td className="p-2">{t.status}</td>
                <td className="p-2 font-mono text-xs">{t.issue_at}</td>
                <td className="p-2 space-x-2">
                  <button className="text-neon-red disabled:opacity-40" disabled={status.isPending}
                    onClick={() => status.mutate({ ids: [t.id], status: 5 })} aria-label={`cancel ${t.id}`}>Cancel</button>
                  <button className="text-neon-green disabled:opacity-40" disabled={status.isPending}
                    onClick={() => status.mutate({ ids: [t.id], status: 0 })} aria-label={`re-execute ${t.id}`}>Re-execute</button>
                  <button className="text-neon-cyan" onClick={() => setReportFor(t)} aria-label={`report ${t.id}`}>Report</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {reportFor && <ReportViewer task={reportFor} onClose={() => setReportFor(null)} />}
    </div>
  );
}

function ReportViewer({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["automation", "report", task.id],
    queryFn: () => getReport({ taskId: task.id }),
  });
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-label="task report">
      <div className="card p-4 space-y-2 w-[32rem] max-h-[80vh] overflow-auto">
        <div className="flex justify-between items-center">
          <h2 className="font-semibold text-fg">Report: {task.name}</h2>
          <button className="btn btn-ghost text-xs" onClick={onClose}>Close</button>
        </div>
        {q.isLoading && <p className="text-fg-muted">Loading report…</p>}
        {q.isError && <p className="text-neon-red">Failed to load report.</p>}
        {q.data && (
          <table className="table card text-xs">
            <thead>
              <tr><th className="p-1">Action</th><th className="p-1">Result</th><th className="p-1">Start</th><th className="p-1">Finish</th></tr>
            </thead>
            <tbody>
              {q.data.list.map((log) => (
                <tr key={log.id}>
                  <td className="p-1">{log.result_info?.action ?? "—"}</td>
                  <td className="p-1">{log.result_info?.result ? "ok" : "fail"}</td>
                  <td className="p-1 font-mono">{log.start_at}</td>
                  <td className="p-1 font-mono">{log.finish_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LoopTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["automation", "loop", params.page, params.pageSize],
    queryFn: () => listLoop({ page: params.page, pageSize: params.pageSize }),
  });
  const [result, setResult] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["automation", "loop"] });

  const status = useMutation({
    mutationFn: (b: { id: string; status: number }) => setLoopStatus(b),
    onSuccess: () => { setResult("Status updated"); invalidate(); },
    onError: (e) => setResult(`Failed: ${(e as Error).message}`),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteLoop(id),
    onSuccess: (r) => { setResult(r.message); invalidate(); },
  });
  const create = useMutation({
    mutationFn: (body: unknown) => createLoop(body),
    onSuccess: (r) => { setResult(`Created plan ${r.id}`); setShowCreate(false); invalidate(); },
    onError: (e) => setResult(`Create failed: ${(e as Error).message}`),
  });

  return (
    <div className="space-y-3">
      <button className="btn btn-cyan" onClick={() => setShowCreate(true)}>Create loop task</button>
      {result && <p className="text-sm text-fg-muted">{result}</p>}
      {q.isLoading && <p className="text-fg-muted">Loading loop tasks…</p>}
      {q.isError && <p className="text-neon-red">Failed to load loop tasks.</p>}
      {q.data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Name</th><th className="p-2">Type</th><th className="p-2">Remark</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {q.data.items.map((p) => (
              <tr key={p.id}>
                <td className="p-2">{p.name}</td>
                <td className="p-2">{p.task_type_name}</td>
                <td className="p-2 text-fg-muted">{p.remark}</td>
                <td className="p-2">{p.status}</td>
                <td className="p-2 space-x-2">
                  <button className="text-neon-amber disabled:opacity-40" disabled={status.isPending}
                    onClick={() => status.mutate({ id: p.id, status: 0 })} aria-label={`pause ${p.id}`}>Pause</button>
                  <button className="text-neon-green disabled:opacity-40" disabled={status.isPending}
                    onClick={() => status.mutate({ id: p.id, status: 1 })} aria-label={`execute ${p.id}`}>Execute</button>
                  <button className="text-neon-red disabled:opacity-40" disabled={del.isPending}
                    onClick={() => del.mutate(p.id)} aria-label={`delete ${p.id}`}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showCreate && <CreateLoopDrawer onClose={() => setShowCreate(false)} onSubmit={(body) => create.mutate(body)} pending={create.isPending} />}
    </div>
  );
}

function CreateLoopDrawer({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (body: unknown) => void; pending: boolean }) {
  const [form, setForm] = useState({ template_id: "", name: "", image_id: "", gap_time: "60" });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.template_id || !form.name || !form.image_id) return;
    onSubmit({
      template_id: form.template_id,
      template_type: 1,
      name: form.name,
      images: [{ image_id: form.image_id, execute_type: 1, gap_time: Number(form.gap_time) || undefined }],
    });
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-label="create loop task">
      <form className="card p-4 space-y-2 w-80" onSubmit={submit}>
        <h2 className="font-semibold text-fg">Create loop task</h2>
        <label className="flex flex-col text-xs text-fg-muted">Template id
          <input className="input mt-1" value={form.template_id}
            onChange={(e) => setForm({ ...form, template_id: e.target.value })} aria-label="template id" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Name
          <input className="input mt-1" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="name" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Image id
          <input className="input mt-1" value={form.image_id}
            onChange={(e) => setForm({ ...form, image_id: e.target.value })} aria-label="image id" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Gap time (minutes, interval)
          <input className="input mt-1" value={form.gap_time}
            onChange={(e) => setForm({ ...form, gap_time: e.target.value })} aria-label="gap time" />
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-green" disabled={pending}>Create</button>
        </div>
      </form>
    </div>
  );
}
