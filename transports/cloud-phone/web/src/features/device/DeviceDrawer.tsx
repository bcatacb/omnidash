import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { CloudPhone, PhoneDetail } from "@duoplus/shared";
import {
  getPhoneInfo, runAdb, enableAdb, disableAdb, batchRoot, resetPhone,
  sharePhones, writeSms, listMembers,
  type AdbResult,
} from "../../api/device";
import { modifyPhones } from "../../api/provision";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-border text-sm gap-4">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

type Tab = "overview" | "details" | "adb" | "actions";

function Feedback({ ok, error }: { ok?: boolean; error?: unknown }) {
  if (error) return <span className="text-xs text-neon-red">{(error as Error).message ?? "error"}</span>;
  if (ok) return <span className="text-xs text-neon-green">done</span>;
  return null;
}

function OverviewTab({ phone }: { phone: CloudPhone }) {
  const [showRemark, setShowRemark] = useState(false);
  return (
    <div>
      <Row label="Status" value={`${phone.powerState} (${phone.statusCode})`} />
      <Row label="OS" value={phone.os} />
      <Row label="Disk" value={phone.size} />
      <Row label="Area" value={phone.area} />
      <Row label="IP" value={phone.ip} />
      <Row label="Group" value={phone.group ?? "—"} />
      <Row label="ADB" value={phone.adb || "—"} />
      <Row label="Expires" value={phone.expiredAt} />
      <div className="mt-3">
        <div className="flex justify-between items-center">
          <span className="text-fg-muted text-sm">Remark (secrets)</span>
          <button className="text-xs text-neon-cyan" onClick={() => setShowRemark((s) => !s)}>{showRemark ? "Hide" : "Reveal"}</button>
        </div>
        <pre className="mt-1 p-2 bg-surface-2 rounded text-xs whitespace-pre-wrap break-all">
          {phone.remark ? (showRemark ? phone.remark : "•••••• (hidden)") : "—"}
        </pre>
      </div>
    </div>
  );
}

function DetailsTab({ id }: { id: string }) {
  const detail = useQuery<PhoneDetail>({ queryKey: ["phone-detail", id], queryFn: () => getPhoneInfo(id) });
  const members = useQuery({ queryKey: ["phone-members"], queryFn: listMembers });
  if (detail.isLoading) return <div className="text-sm text-fg-muted">Loading details…</div>;
  if (detail.isError) return <div className="text-sm text-neon-red">Failed to load details</div>;
  const d = detail.data!;
  return (
    <div>
      {d.proxy && (
        <>
          <h3 className="text-xs font-semibold uppercase text-fg-dim mt-2">Proxy</h3>
          <Row label="IP" value={d.proxy.ip ?? "—"} />
          <Row label="Country" value={d.proxy.country ?? "—"} />
          <Row label="City" value={d.proxy.city ?? "—"} />
          <Row label="DNS" value={d.proxy.dns ?? "—"} />
        </>
      )}
      {d.sim && (
        <>
          <h3 className="text-xs font-semibold uppercase text-fg-dim mt-3">SIM</h3>
          <Row label="Number" value={d.sim.msisdn ?? "—"} />
          <Row label="Operator" value={d.sim.operator ?? "—"} />
          <Row label="ICCID" value={d.sim.iccid ?? "—"} />
        </>
      )}
      {d.wifi && (
        <>
          <h3 className="text-xs font-semibold uppercase text-fg-dim mt-3">WiFi</h3>
          <Row label="SSID" value={d.wifi.name ?? "—"} />
          <Row label="MAC" value={d.wifi.mac ?? "—"} />
        </>
      )}
      {d.device && (
        <>
          <h3 className="text-xs font-semibold uppercase text-fg-dim mt-3">Device</h3>
          <Row label="Model" value={d.device.model ?? "—"} />
          <Row label="Brand" value={d.device.brand ?? "—"} />
          <Row label="IMEI" value={d.device.imei ?? "—"} />
          <Row label="Android ID" value={d.device.android_id ?? "—"} />
        </>
      )}
      {d.gps && (
        <>
          <h3 className="text-xs font-semibold uppercase text-fg-dim mt-3">GPS</h3>
          <Row label="Lat" value={String(d.gps.latitude ?? "—")} />
          <Row label="Lng" value={String(d.gps.longitude ?? "—")} />
        </>
      )}
      <h3 className="text-xs font-semibold uppercase text-fg-dim mt-3">Connected members</h3>
      <div className="text-sm">
        {members.data?.list?.length ? members.data.list.map((m) => (
          <div key={m.user_id} className="py-0.5">{m.nickname}</div>
        )) : <span className="text-fg-dim">—</span>}
      </div>
    </div>
  );
}

function isMulti(r: AdbResult | Record<string, AdbResult>): r is Record<string, AdbResult> {
  return typeof (r as AdbResult).success !== "boolean";
}

function AdbTab({ id }: { id: string }) {
  const [command, setCommand] = useState("");
  const run = useMutation({ mutationFn: (cmd: string) => runAdb({ image_id: id, command: cmd }) });
  const enable = useMutation({ mutationFn: () => enableAdb([id]) });
  const disable = useMutation({ mutationFn: () => disableAdb([id]) });

  const content = run.data
    ? (isMulti(run.data) ? JSON.stringify(run.data, null, 2) : run.data.content)
    : "";

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="adb shell command"
          value={command} onChange={(e) => setCommand(e.target.value)} aria-label="adb command" />
        <button className="btn btn-cyan"
          disabled={!command || run.isPending} onClick={() => run.mutate(command)}>Run</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-green text-xs"
          disabled={enable.isPending} onClick={() => enable.mutate()}>Enable ADB</button>
        <button className="btn btn-ghost text-xs"
          disabled={disable.isPending} onClick={() => disable.mutate()}>Disable ADB</button>
        <button className="btn btn-purple text-xs"
          disabled={run.isPending} onClick={() => run.mutate("DuoPlusDumpUI /sdcard/uidump.xml")}>Dump UI</button>
        <button className="btn btn-amber text-xs"
          disabled={run.isPending}
          onClick={() => { const pkgs = window.prompt("Comma-separated packages"); if (pkgs) run.mutate(`hideAccb ${pkgs}`); }}>Hide Accessibility</button>
      </div>
      <div className="flex gap-3 text-xs">
        <Feedback ok={enable.isSuccess} error={enable.error} />
        <Feedback ok={disable.isSuccess} error={disable.error} />
      </div>
      {run.isError && <div className="text-xs text-neon-red">{(run.error as Error).message}</div>}
      {run.data && (
        <pre className="mt-1 p-2 bg-[#06101a] text-neon-green rounded text-xs whitespace-pre-wrap break-all max-h-60 overflow-auto" aria-label="adb output">
          {content || "(empty)"}
        </pre>
      )}
    </div>
  );
}

function ActionsTab({ id }: { id: string }) {
  const root = useMutation({ mutationFn: (status: number) => batchRoot({ image_ids: [id], status }) });
  const reset = useMutation({ mutationFn: () => resetPhone({ image_id: id }) });
  const share = useMutation({ mutationFn: () => sharePhones([{ image_ids: [id], config: { share_status: 1 } }]) });

  const [sender, setSender] = useState("");
  const [message, setMessage] = useState("");
  const sms = useMutation({ mutationFn: () => writeSms({ image_id: [id], sms: [{ phone: sender, message }] }) });

  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const modify = useMutation({ mutationFn: () => modifyPhones([{ image_id: id, name, remark }]) });
  const modifyOk = modify.data ? modify.data.success.includes(id) : false;

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold uppercase text-fg-dim mb-1">Root</h3>
        <div className="flex gap-2 items-center">
          <button className="btn btn-green text-xs"
            disabled={root.isPending} onClick={() => root.mutate(1)}>Enable Root</button>
          <button className="btn btn-ghost text-xs"
            disabled={root.isPending} onClick={() => root.mutate(2)}>Disable Root</button>
          <Feedback ok={root.isSuccess} error={root.error} />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase text-fg-dim mb-1">Reset / Regenerate</h3>
        <div className="flex gap-2 items-center">
          <button className="btn btn-red text-xs"
            disabled={reset.isPending}
            onClick={() => { if (window.confirm("Reset & regenerate this phone? This wipes the device.")) reset.mutate(); }}>Reset</button>
          <Feedback ok={reset.isSuccess} error={reset.error} />
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase text-fg-dim mb-1">Share</h3>
        <div className="flex gap-2 items-center">
          <button className="btn btn-purple text-xs"
            disabled={share.isPending} onClick={() => share.mutate()}>Enable Share</button>
          <Feedback ok={share.isSuccess} error={share.error} />
        </div>
        {share.data && <div className="text-xs break-all mt-1">{Object.values(share.data).join(", ")}</div>}
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase text-fg-dim mb-1">Rename / Remark</h3>
        <div className="space-y-2">
          <input className="input w-full" placeholder="New name"
            value={name} onChange={(e) => setName(e.target.value)} aria-label="rename name" />
          <input className="input w-full" placeholder="Remark"
            value={remark} onChange={(e) => setRemark(e.target.value)} aria-label="rename remark" />
          <div className="flex gap-2 items-center">
            <button className="btn btn-cyan text-xs"
              disabled={(!name && !remark) || modify.isPending} onClick={() => modify.mutate()}>Save</button>
            <Feedback ok={modifyOk} error={modify.error} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase text-fg-dim mb-1">Write SMS</h3>
        <div className="space-y-2">
          <input className="input w-full" placeholder="Sender number"
            value={sender} onChange={(e) => setSender(e.target.value)} aria-label="sms sender" />
          <textarea className="input w-full" placeholder="Message"
            value={message} onChange={(e) => setMessage(e.target.value)} aria-label="sms message" />
          <div className="flex gap-2 items-center">
            <button className="btn btn-cyan text-xs"
              disabled={!sender || !message || sms.isPending} onClick={() => sms.mutate()}>Inject SMS</button>
            <Feedback ok={sms.isSuccess} error={sms.error} />
          </div>
        </div>
      </section>
    </div>
  );
}

export function DeviceDrawer({ phone, onClose }: { phone: CloudPhone; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "details", label: "Details" },
    { key: "adb", label: "ADB" },
    { key: "actions", label: "Actions" },
  ];
  return (
    <div className="drawer fixed inset-y-0 right-0 w-96 p-4 overflow-y-auto" role="dialog" aria-label="device detail">
      <button className="btn btn-ghost text-xs" onClick={onClose}>Close</button>
      <h2 className="text-lg font-semibold my-2 text-fg">{phone.name}</h2>
      <div className="flex gap-1 border-b border-border mb-3" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            className={`px-3 py-1 text-sm ${tab === t.key ? "border-b-2 border-accent text-accent font-medium" : "text-fg-muted"}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab phone={phone} />}
      {tab === "details" && <DetailsTab id={phone.id} />}
      {tab === "adb" && <AdbTab id={phone.id} />}
      {tab === "actions" && <ActionsTab id={phone.id} />}
    </div>
  );
}
