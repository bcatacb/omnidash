import type { CloudPhone } from "@duoplus/shared";
import { useFleetStore } from "../../store/fleetStore";

const BADGE_CLASS: Record<string, string> = {
  on: "badge badge-on", off: "badge badge-off", booting: "badge badge-booting",
  expired: "badge badge-expired", unknown: "badge badge-unknown",
};

export function FleetGrid({ phones, onOpen }: { phones: CloudPhone[]; onOpen: (id: string) => void }) {
  const selected = useFleetStore((s) => s.selected);
  const toggle = useFleetStore((s) => s.toggle);
  return (
    <table className="table">
      <thead><tr>
        <th className="p-2"></th><th className="p-2">Name</th><th className="p-2">Status</th>
        <th className="p-2">OS</th><th className="p-2">Area</th><th className="p-2">Group</th><th className="p-2">ADB</th>
      </tr></thead>
      <tbody>
        {phones.map((p) => (
          <tr key={p.id}>
            <td className="p-2"><input type="checkbox" aria-label={`select ${p.id}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
            <td className="p-2"><button className="text-neon-cyan hover:underline" onClick={() => onOpen(p.id)}>{p.name}</button></td>
            <td className="p-2"><span className={BADGE_CLASS[p.powerState] ?? "badge badge-unknown"}>{p.powerState}</span></td>
            <td className="p-2">{p.os}</td>
            <td className="p-2">{p.area}</td>
            <td className="p-2 text-fg-muted">{p.group ?? "—"}</td>
            <td className="p-2 text-fg-muted">{p.adb || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
