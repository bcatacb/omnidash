import { create } from "zustand";
import type { PhonePowerState } from "@duoplus/shared";

interface FleetState {
  selected: Set<string>;
  statusFilter: PhonePowerState | "all";
  search: string;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setStatusFilter: (s: PhonePowerState | "all") => void;
  setSearch: (s: string) => void;
}

export const useFleetStore = create<FleetState>((set) => ({
  selected: new Set(),
  statusFilter: "all",
  search: "",
  toggle: (id) => set((st) => {
    const next = new Set(st.selected);
    next.has(id) ? next.delete(id) : next.add(id);
    return { selected: next };
  }),
  selectAll: (ids) => set({ selected: new Set(ids) }),
  clearSelection: () => set({ selected: new Set() }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSearch: (search) => set({ search }),
}));
