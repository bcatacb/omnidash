import { describe, it, expect } from "vitest";
import { mapPhone, mapBatch, unwrap, UpstreamError } from "../src/upstream";

const raw = {
  id: "Qg56Y", name: "snap_Qg56Y", status: 1, os: "Android 15", size: "8.87G",
  created_at: "1779515560", expired_at: "1782107560", ip: "9.1.1.1",
  area: "United States of America(US)", remark: "secret creds", adb: "1.2.3.4:5",
  adb_password: "", group: [{ id: "g1", name: "US Pool" }],
};

describe("upstream mapper", () => {
  it("maps status codes to power states", () => {
    expect(mapPhone({ ...raw, status: 1 }).powerState).toBe("on");
    expect(mapPhone({ ...raw, status: 2 }).powerState).toBe("off");
    expect(mapPhone({ ...raw, status: 10 }).powerState).toBe("booting");
    expect(mapPhone({ ...raw, status: 11 }).powerState).toBe("booting");
    expect(mapPhone({ ...raw, status: 3 }).powerState).toBe("expired");
    expect(mapPhone({ ...raw, status: 4 }).powerState).toBe("expired");
    expect(mapPhone({ ...raw, status: 0 }).powerState).toBe("unknown");
  });
  it("maps fields including first group name", () => {
    const c = mapPhone(raw);
    expect(c).toMatchObject({ id: "Qg56Y", name: "snap_Qg56Y", statusCode: 1, os: "Android 15", size: "8.87G", area: raw.area, ip: "9.1.1.1", group: "US Pool", adb: "1.2.3.4:5", remark: "secret creds", createdAt: "1779515560", expiredAt: "1782107560" });
  });
  it("maps empty group to null", () => {
    expect(mapPhone({ ...raw, group: [] }).group).toBeNull();
  });
  it("maps success/fail arrays into ok/error results", () => {
    const out = mapBatch({ success: ["a", "b"], fail: ["c"] });
    expect(out.results).toEqual([
      { id: "a", ok: true }, { id: "b", ok: true }, { id: "c", ok: false, error: "operation failed" },
    ]);
  });
  it("unwrap throws on non-200 code", () => {
    expect(() => unwrap({ code: 401, message: "bad key", data: null })).toThrow(UpstreamError);
    expect(unwrap({ code: 200, message: "Success", data: { ok: 1 } })).toEqual({ ok: 1 });
  });
});
