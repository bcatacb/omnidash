import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../test/mswHandlers";
import { listPhones, batchPower } from "./cloudPhone";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("cloudPhone api", () => {
  it("listPhones returns typed paginated data", async () => {
    const res = await listPhones({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0].powerState).toBe("on");
    expect(res.items[0].os).toBe("Android 15");
  });
  it("batchPower posts ids + action", async () => {
    const res = await batchPower(["cp-1"], "off");
    expect(res.results[0]).toEqual({ id: "cp-1", ok: true });
  });
});
