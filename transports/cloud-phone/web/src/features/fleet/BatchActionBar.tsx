import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { PowerAction } from "@duoplus/shared";
import { useFleetStore } from "../../store/fleetStore";
import { useBatchPower } from "./useFleet";
import { listGroups, moveToGroup } from "../../api/groups";
import { listPlatformApps, installApp } from "../../api/apps";
import { batchRoot, enableAdb, disableAdb } from "../../api/device";
import { renewPhones } from "../../api/provision";

const RENEW_DURATIONS = [7, 30, 90, 180, 360];

export function BatchActionBar({ params }: { params: { page: number; pageSize: number } }) {
  const selected = useFleetStore((s) => s.selected);
  const power = useBatchPower(params);
  const ids = [...selected];
  const disabled = ids.length === 0 || power.isPending;

  const groups = useQuery({ queryKey: ["groups", 1], queryFn: () => listGroups({ page: 1 }) });
  const [groupId, setGroupId] = useState("");
  const move = useMutation({ mutationFn: () => moveToGroup(groupId, ids) });
  const moveDisabled = ids.length === 0 || !groupId || move.isPending;

  const apps = useQuery({ queryKey: ["apps", "platform", 1, 50], queryFn: () => listPlatformApps({ page: 1, pageSize: 50 }) });
  const [appId, setAppId] = useState("");
  const install = useMutation({ mutationFn: () => installApp({ image_ids: ids, app_id: appId }) });
  const installDisabled = ids.length === 0 || !appId || install.isPending;

  const run = (action: PowerAction) => power.mutate({ ids, action });

  const [renewDuration, setRenewDuration] = useState(30);
  const renew = useMutation({ mutationFn: () => renewPhones({ image_ids: ids, duration: renewDuration }) });
  const renewDisabled = ids.length === 0 || renew.isPending;

  const root = useMutation({ mutationFn: (status: number) => batchRoot({ image_ids: ids, status }) });
  const adbOn = useMutation({ mutationFn: () => enableAdb(ids) });
  const adbOff = useMutation({ mutationFn: () => disableAdb(ids) });

  return (
    <div className="flex items-center gap-2 p-2 border-b border-border bg-surface sticky top-0">
      <span className="text-sm text-fg-muted">{ids.length} selected</span>
      <button className="btn btn-green"
        disabled={disabled} onClick={() => run("on")}>Power On</button>
      <button className="btn btn-red"
        disabled={disabled} onClick={() => run("off")}>Power Off</button>
      <button className="btn btn-amber"
        disabled={disabled} onClick={() => run("restart")}>Restart</button>
      {power.data && (
        <span className="text-sm text-fg-muted">
          {power.data.results.filter((r) => r.ok).length} ok,{" "}
          {power.data.results.filter((r) => !r.ok).length} failed
        </span>
      )}

      <button className="btn btn-purple"
        disabled={disabled || root.isPending} onClick={() => root.mutate(1)}>Set root</button>
      <button className="btn btn-ghost"
        disabled={disabled || root.isPending} onClick={() => root.mutate(2)}>Unset root</button>
      {root.data && <span className="text-sm text-fg-muted">root: {root.data.success.length} ok, {root.data.fail.length} failed</span>}

      <button className="btn btn-cyan"
        disabled={disabled || adbOn.isPending} onClick={() => adbOn.mutate()}>Enable ADB</button>
      <button className="btn btn-ghost"
        disabled={disabled || adbOff.isPending} onClick={() => adbOff.mutate()}>Disable ADB</button>
      {adbOn.data && <span className="text-sm text-fg-muted">adb on: {adbOn.data.success.length} ok</span>}
      {adbOff.data && <span className="text-sm text-fg-muted">adb off: {adbOff.data.success.length} ok</span>}

      <select className="select" value={renewDuration}
        onChange={(e) => setRenewDuration(Number(e.target.value))} aria-label="renew duration">
        {RENEW_DURATIONS.map((d) => <option key={d} value={d}>{d}d</option>)}
      </select>
      <button className="btn btn-pink"
        disabled={renewDisabled} onClick={() => renew.mutate()}>Renew</button>
      {renew.data && <span className="text-sm text-fg-muted">order: <span className="font-mono">{renew.data.order_id}</span></span>}

      <span className="ml-auto flex items-center gap-2">
        <select className="select" value={groupId}
          onChange={(e) => setGroupId(e.target.value)} aria-label="move to group">
          <option value="">Move to group…</option>
          {groups.data?.items.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button className="btn btn-blue"
          disabled={moveDisabled} onClick={() => move.mutate()}>Move</button>
        {move.isSuccess && <span className="text-sm text-fg-muted">moved</span>}

        <select className="select" value={appId}
          onChange={(e) => setAppId(e.target.value)} aria-label="install app">
          <option value="">Install app…</option>
          {apps.data?.items.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button className="btn btn-green"
          disabled={installDisabled} onClick={() => install.mutate()}>Install</button>
        {install.isSuccess && <span className="text-sm text-fg-muted">installed</span>}
      </span>
    </div>
  );
}
