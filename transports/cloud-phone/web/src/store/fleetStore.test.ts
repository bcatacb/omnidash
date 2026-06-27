import { describe, it, expect, beforeEach } from "vitest";
import { useFleetStore } from "./fleetStore";

describe("fleetStore", () => {
  beforeEach(() => useFleetStore.getState().clearSelection());

  it("toggles a phone in and out of selection", () => {
    const s = useFleetStore.getState();
    s.toggle("cp-1");
    expect(useFleetStore.getState().selected.has("cp-1")).toBe(true);
    useFleetStore.getState().toggle("cp-1");
    expect(useFleetStore.getState().selected.has("cp-1")).toBe(false);
  });

  it("selectAll replaces selection; clearSelection empties it", () => {
    useFleetStore.getState().selectAll(["a", "b"]);
    expect(useFleetStore.getState().selected.size).toBe(2);
    useFleetStore.getState().clearSelection();
    expect(useFleetStore.getState().selected.size).toBe(0);
  });

  it("setStatusFilter stores the filter", () => {
    useFleetStore.getState().setStatusFilter("on");
    expect(useFleetStore.getState().statusFilter).toBe("on");
  });
});
