import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../test/mswHandlers";
import { listProxies, addProxies, deleteProxies, refreshProxies, updateProxy } from "./proxies";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("proxies api", () => {
  it("listProxies returns typed paginated data", async () => {
    const res = await listProxies({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: "px-1", host: "104.16.0.1", port: 1080 });
  });
  it("addProxies posts proxy_list and returns success", async () => {
    const res = await addProxies([{ protocol: "socks5", host: "9.9.9.9", port: 1080 }]);
    expect(res.success[0]).toMatchObject({ index: 0 });
  });
  it("deleteProxies forwards ids", async () => {
    const res = await deleteProxies(["px-1"]);
    expect(res.success).toEqual(["px-1"]);
  });
  it("refreshProxies forwards ids", async () => {
    const res = await refreshProxies(["px-1"]);
    expect(res.success).toEqual(["px-1"]);
  });
  it("updateProxy returns message", async () => {
    const res = await updateProxy({ id: "px-1", host: "2.2.2.2" });
    expect(res.message).toBe("Success");
  });
});
