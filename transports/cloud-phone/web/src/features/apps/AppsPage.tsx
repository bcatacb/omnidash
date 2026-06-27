import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { AppItem } from "@duoplus/shared";
import {
  listPlatformApps, listTeamApps, installApp, uninstallApp, startApp, stopApp,
} from "../../api/apps";

const params = { page: 1, pageSize: 50 };
type Tab = "platform" | "team";

function parseIds(raw: string): string[] {
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export function AppsPage() {
  const [tab, setTab] = useState<Tab>("platform");
  const [phoneIds, setPhoneIds] = useState("");
  const [selectedApp, setSelectedApp] = useState<AppItem | null>(null);
  const [versionId, setVersionId] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const platform = useQuery({ queryKey: ["apps", "platform", params.page, params.pageSize], queryFn: () => listPlatformApps(params) });
  const team = useQuery({ queryKey: ["apps", "team", params.page, params.pageSize], queryFn: () => listTeamApps(params) });
  const active = tab === "platform" ? platform : team;

  const ids = parseIds(phoneIds);

  const install = useMutation({
    mutationFn: () => installApp({ image_ids: ids, app_id: selectedApp!.id, app_version_id: versionId || undefined }),
    onSuccess: (r) => setResult(`Install: ${r.message}`),
    onError: (e) => setResult(`Install failed: ${(e as Error).message}`),
  });
  const uninstall = useMutation({
    mutationFn: (pkg: string) => uninstallApp({ image_ids: ids, pkg }),
    onSuccess: (r) => setResult(`Uninstall: ${r.message}`),
  });
  const start = useMutation({
    mutationFn: (pkg: string) => startApp({ image_ids: ids, pkg }),
    onSuccess: (r) => setResult(`Start: ${r.message}`),
  });
  const stop = useMutation({
    mutationFn: (pkg: string) => stopApp({ image_ids: ids, pkg }),
    onSuccess: (r) => setResult(`Stop: ${r.message}`),
  });

  const actionsDisabled = ids.length === 0;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Apps</h1>

      <div className="flex gap-2 border-b border-border">
        <button className={`px-3 py-2 text-sm ${tab === "platform" ? "border-b-2 border-accent text-accent font-semibold" : "text-fg-muted"}`}
          onClick={() => setTab("platform")}>Platform</button>
        <button className={`px-3 py-2 text-sm ${tab === "team" ? "border-b-2 border-accent text-accent font-semibold" : "text-fg-muted"}`}
          onClick={() => setTab("team")}>Team</button>
      </div>

      <label className="flex flex-col text-xs max-w-lg text-fg-muted">Target phone ids (comma or space separated)
        <input className="input mt-1" value={phoneIds}
          onChange={(e) => setPhoneIds(e.target.value)} placeholder="cp-1, cp-2" aria-label="target phone ids" />
      </label>

      {result && <p className="text-sm text-fg-muted">{result}</p>}

      {active.isLoading && <p className="text-fg-muted">Loading apps…</p>}
      {active.isError && <p className="text-neon-red">Failed to load apps.</p>}

      {active.data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Name</th><th className="p-2">Package</th><th className="p-2">Versions</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {active.data.items.map((a) => (
              <tr key={a.id}>
                <td className="p-2">{a.name}</td>
                <td className="p-2 font-mono text-xs">{a.pkg}</td>
                <td className="p-2">{a.version_list.map((v) => v.name).join(", ")}</td>
                <td className="p-2 space-x-2">
                  <button className="text-neon-cyan disabled:opacity-40" disabled={actionsDisabled}
                    onClick={() => { setSelectedApp(a); setVersionId(a.version_list[0]?.id ?? ""); }}
                    aria-label={`install ${a.id}`}>Install</button>
                  <button className="text-neon-red disabled:opacity-40" disabled={actionsDisabled || uninstall.isPending}
                    onClick={() => uninstall.mutate(a.pkg)} aria-label={`uninstall ${a.id}`}>Uninstall</button>
                  <button className="text-neon-green disabled:opacity-40" disabled={actionsDisabled || start.isPending}
                    onClick={() => start.mutate(a.pkg)} aria-label={`start ${a.id}`}>Start</button>
                  <button className="text-fg-muted disabled:opacity-40" disabled={actionsDisabled || stop.isPending}
                    onClick={() => stop.mutate(a.pkg)} aria-label={`stop ${a.id}`}>Stop</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center" role="dialog" aria-label="install app">
          <form
            className="card p-4 space-y-2 w-80"
            onSubmit={(e) => { e.preventDefault(); install.mutate(); }}
          >
            <h2 className="font-semibold text-fg">Install {selectedApp.name}</h2>
            <p className="text-xs text-fg-dim">Targets: {ids.join(", ") || "(none)"}</p>
            <label className="flex flex-col text-xs text-fg-muted">Version
              <select className="select mt-1" value={versionId}
                onChange={(e) => setVersionId(e.target.value)} aria-label="app version">
                {selectedApp.version_list.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => setSelectedApp(null)}>Cancel</button>
              <button type="submit" className="btn btn-green"
                disabled={install.isPending || actionsDisabled}>Install</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
