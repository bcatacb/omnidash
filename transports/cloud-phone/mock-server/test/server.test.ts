import { describe, it, expect, beforeEach } from "vitest";
import { buildMock } from "../src/server";

describe("mock upstream (real contract)", () => {
  let app: ReturnType<typeof buildMock>;
  beforeEach(() => { app = buildMock(); });

  it("POST /api/v1/cloudPhone/list returns code 200 envelope", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/cloudPhone/list", payload: { page: 1, pagesize: 5 } });
    const body = res.json();
    expect(body.code).toBe(200);
    expect(body.data.list).toHaveLength(5);
    expect(body.data.total).toBe(12);
    expect(typeof body.data.list[0].status).toBe("number");
  });

  it("POST powerOff moves phones to status 2 and returns success ids", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/cloudPhone/powerOff", payload: { image_ids: ["cp-100", "cp-101"] } });
    const body = res.json();
    expect(body.code).toBe(200);
    expect(body.data.success).toEqual(["cp-100", "cp-101"]);
    expect(body.data.fail).toEqual([]);
  });

  it("POST status returns light list", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/cloudPhone/status", payload: { image_ids: ["cp-100"] } });
    expect(res.json().data.list[0]).toMatchObject({ id: "cp-100" });
  });
});
