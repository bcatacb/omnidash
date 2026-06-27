import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../test/mswHandlers";
import { listNumbers, listSms, purchaseNumberPackage, getRenewalPackage, purchaseNumber, renewNumbers } from "./numbers";

let smsUrl: URL | null = null;
const smsSpy = http.get("/api/numbers/:id/sms", ({ request, params }) => {
  smsUrl = new URL(request.url);
  // Confirm the route param carried the real id, not a literal ":id"
  expect(params.id).toBe("num-1");
  return HttpResponse.json({ items: [{ message: "code 482913", code: "482913", received_at: "2026-06-14 11:02:00" }], page: 1, pageSize: 20, total: 1 });
});

const server = setupServer(smsSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); smsUrl = null; });
afterAll(() => server.close());

describe("numbers api", () => {
  it("listNumbers returns typed paginated data", async () => {
    const res = await listNumbers({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: "num-1", phone_number: "+15551230001" });
  });

  it("listSms requests the per-number sms path with the id", async () => {
    const res = await listSms({ id: "num-1", page: 1, pageSize: 20 });
    expect(res.items[0]).toMatchObject({ code: "482913" });
    expect(smsUrl?.pathname).toBe("/api/numbers/num-1/sms");
  });

  it("purchaseNumberPackage returns durations", async () => {
    const res = await purchaseNumberPackage({ region: "US" });
    expect(res.duration).toContain("30");
  });

  it("getRenewalPackage returns numbers", async () => {
    const res = await getRenewalPackage(["num-1"]);
    expect(res.numbers[0]).toMatchObject({ id: "num-1" });
  });

  it("purchaseNumber returns order id", async () => {
    const res = await purchaseNumber({ region: "US", duration: 30, quantity: 1 });
    expect(res.order_id).toBe("ord-num-1");
  });

  it("renewNumbers returns order id", async () => {
    const res = await renewNumbers([{ number_ids: ["num-1"], duration: 30 }]);
    expect(res.order_id).toBe("ord-num-renew");
  });
});
