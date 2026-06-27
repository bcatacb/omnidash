import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../test/mswHandlers";
import { listPlatformApps, listTeamApps, installApp, uninstallApp, startApp, stopApp, listInstalledApps } from "./apps";

let installBody: unknown = null;
const installSpy = http.post("/api/apps/install", async ({ request }) => {
  installBody = await request.json();
  return HttpResponse.json({ message: "success" });
});

const server = setupServer(installSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); installBody = null; });
afterAll(() => server.close());

describe("apps api", () => {
  it("listPlatformApps returns typed paginated data", async () => {
    const res = await listPlatformApps({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: "app-1", pkg: "com.android.chrome" });
  });
  it("listTeamApps returns typed paginated data", async () => {
    const res = await listTeamApps({ page: 1, pageSize: 20 });
    expect(res.items[0]).toMatchObject({ id: "tapp-1", pkg: "com.acme.automation" });
  });
  it("installApp forwards {image_ids,app_id}", async () => {
    const res = await installApp({ image_ids: ["cp-1"], app_id: "app-1" });
    expect(res.message).toBe("success");
    expect(installBody).toEqual({ image_ids: ["cp-1"], app_id: "app-1" });
  });
  it("uninstallApp returns message", async () => {
    const res = await uninstallApp({ image_ids: ["cp-1"], pkg: "com.whatsapp" });
    expect(res.message).toBe("success");
  });
  it("startApp returns message", async () => {
    const res = await startApp({ image_ids: ["cp-1"], pkg: "com.whatsapp" });
    expect(res.message).toBe("success");
  });
  it("stopApp returns message", async () => {
    const res = await stopApp({ image_ids: ["cp-1"], pkg: "com.whatsapp" });
    expect(res.message).toBe("success");
  });
  it("listInstalledApps returns list", async () => {
    const res = await listInstalledApps("cp-1");
    expect(res.list).toContain("com.android.chrome");
  });
});
