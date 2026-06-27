import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../test/mswHandlers";
import { buyPhones, renewPhones, modifyPhones } from "./provision";

let buyBody: unknown = null;
const buySpy = http.post("/api/phones/buy", async ({ request }) => {
  buyBody = await request.json();
  return HttpResponse.json({ order_id: "ord-buy-1" });
});

let renewBody: unknown = null;
const renewSpy = http.post("/api/phones/renew", async ({ request }) => {
  renewBody = await request.json();
  return HttpResponse.json({ order_id: "ord-renew-1" });
});

let modifyBody: unknown = null;
const modifySpy = http.post("/api/phones/modify", async ({ request }) => {
  modifyBody = await request.json();
  const body = modifyBody as { images: Array<{ image_id: string }> };
  return HttpResponse.json({ success: body.images.map((i) => i.image_id), fail: [], fail_reason: {} });
});

const server = setupServer(buySpy, renewSpy, modifySpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); buyBody = null; renewBody = null; modifyBody = null; });
afterAll(() => server.close());

describe("provision api", () => {
  it("buyPhones posts {os,duration,quantity} and returns order id", async () => {
    const res = await buyPhones({ os: "15", duration: 30, quantity: 2 });
    expect(res.order_id).toBe("ord-buy-1");
    expect(buyBody).toMatchObject({ os: "15", duration: 30, quantity: 2 });
  });

  it("renewPhones posts {image_ids,duration} and returns order id", async () => {
    const res = await renewPhones({ image_ids: ["cp-1"], duration: 90 });
    expect(res.order_id).toBe("ord-renew-1");
    expect(renewBody).toMatchObject({ image_ids: ["cp-1"], duration: 90 });
  });

  it("modifyPhones wraps images and returns success", async () => {
    const res = await modifyPhones([{ image_id: "cp-1", name: "New", remark: "r" }]);
    expect(res.success).toContain("cp-1");
    expect(modifyBody).toMatchObject({ images: [{ image_id: "cp-1", name: "New", remark: "r" }] });
  });
});
