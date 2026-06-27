import { http, HttpResponse } from "msw";

const phone = {
  id: "cp-1", name: "P1", powerState: "on", statusCode: 1, os: "Android 15", size: "8G",
  area: "US", ip: "1.1.1.1", group: "US Pool", adb: "1.1.1.1:5", remark: "Username: x\nPassword: y",
  createdAt: "1", expiredAt: "2",
};

const proxyRow = { id: "px-1", name: "US-Residential", host: "104.16.0.1", port: 1080, user: "user1", area: "United States(US)" };
const groupRow = { id: "grp-1", name: "US Warmup", sort: 0, remark: "fresh accounts", image_count: 4 };
const platformApp = { id: "app-1", name: "Google Chrome", pkg: "com.android.chrome", version_list: [{ id: "av-1", name: "120.0.6099" }] };
const teamApp = { id: "tapp-1", name: "Acme Automation", pkg: "com.acme.automation", version_list: [{ id: "tav-1", name: "1.4.0" }] };
const driveRow = { id: "file-1", name: "promo.mp4", original_file_name: "summer-promo-final.mp4" };
const customTemplate = { id: "tpl-1", name: "Account Warmup", desc: "Daily scroll + like routine" };
const officialTemplate = { id: "otpl-1", name: "TikTok Warmup", desc: "Official TikTok warmup flow" };
const scheduledTask = { id: "task-1", name: "Morning warmup", task_type_name: "Account Warmup", image_name: "P1", ip: "104.16.0.1", status: 1, issue_at: "2026-06-15 09:00:00", created_at: "2026-06-14 08:00:00" };
const loopTask = { id: "plan-1", name: "Hourly engagement", remark: "every 60m", task_type_name: "Account Warmup", status: 1, created_at: "2026-06-14 08:00:00" };
const cloudNumber = { id: "num-1", phone_number: "+15551230001", region_name: "United States", type_name: "Mobile", status_name: "On", renewal_status: 1, remark: "WhatsApp line", created_at: "2026-05-01 10:00:00", expired_at: "2026-07-01 10:00:00" };
const numberSms = { message: "Your WhatsApp code is 482913. Do not share it.", code: "482913", received_at: "2026-06-14 11:02:00" };
const order = { type: "Cloud Phone", order_id: "ord-1001", product: "Android 15", description: "30 days x 2", status: "Paid", total: "19.98", created_at: "2026-06-01 10:00:00", expired_at: "2026-07-01 10:00:00" };
const subscription = { id: "sub-1", name: "Starter Plan", cpu: "4 vCPU", ram: "8G", rom: "64G", renewal_status: 1, free_status: 1, remark: "team default", expired_at: "2026-07-15 00:00:00", created_at: "2026-06-15 00:00:00", need_renewal: false };

export const handlers = [
  http.get("/api/phones", () => HttpResponse.json({ items: [phone], page: 1, pageSize: 20, total: 1 })),
  http.post("/api/phones/power", async ({ request }) => {
    const body = (await request.json()) as { ids: string[] };
    return HttpResponse.json({ results: body.ids.map((id) => ({ id, ok: true })) });
  }),

  // Proxies
  http.get("/api/proxies", () => HttpResponse.json({ items: [proxyRow], page: 1, pageSize: 20, total: 1 })),
  http.post("/api/proxies", async ({ request }) => {
    const body = (await request.json()) as { proxy_list: unknown[] };
    return HttpResponse.json({ success: body.proxy_list.map((_, index) => ({ index, id: `px-new-${index}` })), fail: [] });
  }),
  http.post("/api/proxies/delete", async ({ request }) => {
    const body = (await request.json()) as { ids: string[] };
    return HttpResponse.json({ success: body.ids, fail: [] });
  }),
  http.post("/api/proxies/refresh", async ({ request }) => {
    const body = (await request.json()) as { ids: string[] };
    return HttpResponse.json({ success: body.ids, fail: [] });
  }),
  http.post("/api/proxies/update", async () => HttpResponse.json({ message: "Success", result: [] })),

  // Groups
  http.get("/api/groups", () => HttpResponse.json({ items: [groupRow], page: 1, pageSize: 200, total: 1 })),
  http.post("/api/groups", async ({ request }) => {
    const body = (await request.json()) as { list: { name: string; sort?: number; remark?: string }[] };
    return HttpResponse.json({ success: body.list.map((g, index) => ({ index, id: `grp-new-${index}`, name: g.name, sort: g.sort ?? 0, remark: g.remark ?? "" })), fail: [] });
  }),
  http.post("/api/groups/update", async ({ request }) => {
    const body = (await request.json()) as { list: { id: string; name: string; sort?: number; remark?: string }[] };
    return HttpResponse.json({ success: body.list.map((g, index) => ({ index, id: g.id, name: g.name, sort: g.sort ?? 0, remark: g.remark ?? "" })), fail: [] });
  }),
  http.post("/api/groups/delete", async ({ request }) => {
    const body = (await request.json()) as { ids: string[] };
    return HttpResponse.json({ success: body.ids, fail: [] });
  }),
  http.post("/api/groups/assign", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/groups/move", async () => HttpResponse.json({ message: "Success" })),

  // Apps
  http.get("/api/apps/platform", () => HttpResponse.json({ items: [platformApp], page: 1, pageSize: 20, total: 1 })),
  http.get("/api/apps/team", () => HttpResponse.json({ items: [teamApp], page: 1, pageSize: 20, total: 1 })),
  http.post("/api/apps/install", async () => HttpResponse.json({ message: "success" })),
  http.post("/api/apps/uninstall", async () => HttpResponse.json({ message: "success" })),
  http.post("/api/apps/start", async () => HttpResponse.json({ message: "success" })),
  http.post("/api/apps/stop", async () => HttpResponse.json({ message: "success" })),
  http.get("/api/apps/installed", () => HttpResponse.json({ list: ["com.android.chrome"] })),

  // Device actions
  http.get("/api/phones/members", () => HttpResponse.json({ list: [{ user_id: "u-1", nickname: "Alice" }] })),
  http.get("/api/phones/:id", ({ params }) => HttpResponse.json({
    id: params.id,
    name: "P1",
    remark: "secret",
    os: "Android 15",
    group: [{ id: "grp-1", name: "US Warmup" }],
    proxy: { id: "px-1", dns: "1.1.1.1", ip: "104.16.0.1", country: "US", region: "CA", city: "Los Angeles", zipcode: "90001" },
    gps: { longitude: -118.2, latitude: 34.0 },
    locale: { timezone: "America/Los_Angeles", language: "en-US" },
    sim: { status: 1, country: "US", msisdn: "+15551234567", operator: "AT&T", iccid: "8901410123456789012", mcc: "310", mnc: "410" },
    bluetooth: { name: "BT", address: "00:11:22:33:44:55" },
    wifi: { status: 1, name: "HomeNet", mac: "aa:bb:cc:dd:ee:ff", bssid: "11:22:33:44:55:66" },
    device: { manufacturer: "Samsung", brand: "samsung", model: "SM-G991B", imei: "356938035643809", serialno: "RF8N", android_id: "9a1b2c3d", gsf_id: "gsf", gaid: "gaid" },
  })),
  http.post("/api/phones/root", async ({ request }) => {
    const body = (await request.json()) as { image_ids: string[] };
    return HttpResponse.json({ success: body.image_ids, fail: [], fail_reason: {} });
  }),
  http.post("/api/phones/reset", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/phones/share", async ({ request }) => {
    const body = (await request.json()) as { share: Array<{ image_ids: string[] }> };
    const data: Record<string, string> = {};
    for (const s of body.share) for (const id of s.image_ids) data[id] = `https://share.example/${id}`;
    return HttpResponse.json(data);
  }),
  http.post("/api/phones/share-password", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/phones/write-sms", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/phones/live", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/phones/scan", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/phones/adb/enable", async ({ request }) => {
    const body = (await request.json()) as { image_ids: string[] };
    return HttpResponse.json({ success: body.image_ids, fail: [], fail_reason: {} });
  }),
  http.post("/api/phones/adb/disable", async ({ request }) => {
    const body = (await request.json()) as { image_ids: string[] };
    return HttpResponse.json({ success: body.image_ids, fail: [], fail_reason: {} });
  }),
  http.post("/api/phones/adb", async ({ request }) => {
    const body = (await request.json()) as { image_ids?: string[]; image_id?: string };
    if (body.image_ids) {
      const data: Record<string, unknown> = {};
      for (const id of body.image_ids) data[id] = { success: true, content: "ok", message: "ok" };
      return HttpResponse.json(data);
    }
    return HttpResponse.json({ success: true, content: "uid-dump-output", message: "ok" });
  }),

  // Automation
  http.get("/api/automation/templates", ({ request }) => {
    const type = new URL(request.url).searchParams.get("type");
    const item = type === "official" ? officialTemplate : customTemplate;
    return HttpResponse.json({ items: [item], page: 1, pageSize: 20, total: 1 });
  }),
  http.get("/api/automation/scheduled", () => HttpResponse.json({ items: [scheduledTask], page: 1, pageSize: 20, total: 1 })),
  http.get("/api/automation/loop", () => HttpResponse.json({ items: [loopTask], page: 1, pageSize: 20, total: 1 })),
  http.post("/api/automation/scheduled", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/automation/loop", async () => HttpResponse.json({ id: "plan-new" })),
  http.post("/api/automation/loop/save", async () => HttpResponse.json({ id: "plan-1" })),
  http.post("/api/automation/loop/status", async ({ request }) => {
    const body = (await request.json()) as { id: string };
    return HttpResponse.json({ id: body.id });
  }),
  http.post("/api/automation/loop/delete", async () => HttpResponse.json({ message: "Success" })),
  http.get("/api/automation/report", () => HttpResponse.json({ list: [{ id: "log-1", result_info: { action: "openApp", result: true }, start_at: "2026-06-15 09:00:00", finish_at: "2026-06-15 09:00:05", created_at: "2026-06-15 09:00:00" }] })),
  http.post("/api/automation/scheduled/status", async () => HttpResponse.json({ success: ["task-1"], fail: [], fail_reason: {} })),
  http.post("/api/automation/scheduled/time", async () => HttpResponse.json({ message: "Success" })),

  // Drive
  http.get("/api/drive/files", () => HttpResponse.json({ items: [driveRow], page: 1, pageSize: 20, total: 1 })),
  http.post("/api/drive/push", async () => HttpResponse.json({ message: "Success", success: [], fail: [] })),
  http.post("/api/drive/delete", async () => HttpResponse.json({ message: "Success" })),
  http.post("/api/drive/upload-url", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({ method: "PUT", signedUrl: "https://oss.example/put", headers: { "x-oss-callback": "cb" }, name: body.name, original_file_name: body.name });
  }),

  // Cloud Numbers
  http.get("/api/numbers", () => HttpResponse.json({ items: [cloudNumber], page: 1, pageSize: 20, total: 1 })),
  http.get("/api/numbers/:id/sms", () => HttpResponse.json({ items: [numberSms], page: 1, pageSize: 20, total: 1 })),
  http.post("/api/numbers/package", async () => HttpResponse.json({ duration: ["30", "90"] })),
  http.post("/api/numbers/renewal-package", async () => HttpResponse.json({ numbers: [{ id: "num-1", phone_number: "+15551230001", expired_at: "2026-07-01", duration: [30, 90] }] })),
  http.post("/api/numbers/purchase", async () => HttpResponse.json({ order_id: "ord-num-1" })),
  http.post("/api/numbers/renew", async () => HttpResponse.json({ order_id: "ord-num-renew" })),

  // Reference data
  http.get("/api/reference/models", () => HttpResponse.json({ Samsung: { m1: { name: "Galaxy S23" } }, Google: { m3: { name: "Pixel 8" } } })),
  http.get("/api/reference/resources", () => HttpResponse.json({ list: [{ name: "US", region_id: "r1", os: "Android 15", count: 10, used_count: 3 }] })),
  http.get("/api/reference/resolutions", () => HttpResponse.json({ list: ["720x1280(320dpi)", "1080x1920(480dpi)"] })),
  http.get("/api/reference/tags", () => HttpResponse.json({ items: [{ id: "tag-1", name: "warmup", color: "#22c55e", image_count: 12 }], page: 1, pageSize: 20, total: 1 })),

  // Provision (buy / renew / modify)
  http.post("/api/phones/buy", async () => HttpResponse.json({ order_id: "ord-buy-1" })),
  http.post("/api/phones/renew", async () => HttpResponse.json({ order_id: "ord-renew-1" })),
  http.post("/api/phones/modify", async ({ request }) => {
    const body = (await request.json()) as { images: Array<{ image_id: string }> };
    return HttpResponse.json({ success: body.images.map((i) => i.image_id), fail: [], fail_reason: {} });
  }),

  // Account / Orders + Subscriptions
  http.get("/api/orders", () => HttpResponse.json({ items: [order], page: 1, pageSize: 20, total: 1 })),
  http.get("/api/subscriptions", () => HttpResponse.json({ items: [subscription], page: 1, pageSize: 20, total: 1 })),
  http.post("/api/subscriptions/purchase", async () => HttpResponse.json({ order_id: "ord-sub-1" })),
  http.post("/api/subscriptions/renew", async () => HttpResponse.json({ order_id: "ord-sub-renew" })),
];
