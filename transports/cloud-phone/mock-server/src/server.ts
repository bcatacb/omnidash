import Fastify, { type FastifyInstance } from "fastify";
import { seedPhones } from "./data.js";

export function buildMock(): FastifyInstance {
  const app = Fastify();
  const phones = seedPhones();

  app.post("/api/v1/cloudPhone/list", async (req) => {
    const { page = 1, pagesize = 10 } = (req.body ?? {}) as { page?: number; pagesize?: number };
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: phones.slice(start, start + pagesize), page, pagesize, total: phones.length, total_page: Math.ceil(phones.length / pagesize) } };
  });

  app.post("/api/v1/cloudPhone/status", async (req) => {
    const { image_ids = [] } = (req.body ?? {}) as { image_ids?: string[] };
    const list = phones.filter((p) => image_ids.includes(p.id)).map((p) => ({ id: p.id, name: p.name, status: p.status }));
    return { code: 200, message: "Success", data: { list } };
  });

  function power(toStatus: number) {
    return async (req: { body: unknown }) => {
      const { image_ids = [] } = (req.body ?? {}) as { image_ids?: string[] };
      const success: string[] = [];
      for (const id of image_ids) {
        const phone = phones.find((p) => p.id === id);
        if (phone) { phone.status = toStatus; success.push(id); }
      }
      return { code: 200, message: "Success", data: { success, fail: [] } };
    };
  }
  app.post("/api/v1/cloudPhone/powerOn", power(1));
  app.post("/api/v1/cloudPhone/powerOff", power(2));
  app.post("/api/v1/cloudPhone/restart", power(10));

  // --- Device actions ---
  app.post("/api/v1/cloudPhone/info", async (req) => {
    const { image_id } = (req.body ?? {}) as { image_id?: string };
    const phone = phones.find((p) => p.id === image_id);
    return {
      code: 200,
      message: "Success",
      data: {
        id: image_id,
        name: phone?.name ?? "Cloud Phone",
        remark: phone?.remark ?? "",
        os: phone?.os ?? "Android 15",
        group: [{ id: "grp-1", name: "US Warmup" }],
        proxy: { id: "px-1", dns: "1.1.1.1", ip: "104.16.0.1", country: "US", region: "California", city: "Los Angeles", zipcode: "90001" },
        gps: { longitude: -118.2437, latitude: 34.0522 },
        locale: { timezone: "America/Los_Angeles", language: "en-US" },
        sim: { status: 1, country: "US", msisdn: "+15551234567", operator: "AT&T", msin: "0123456789", iccid: "8901410123456789012", mcc: "310", mnc: "410" },
        bluetooth: { name: "Galaxy-BT", address: "00:11:22:33:44:55" },
        wifi: { status: 1, name: "HomeNet", mac: "aa:bb:cc:dd:ee:ff", bssid: "11:22:33:44:55:66" },
        device: { manufacturer: "Samsung", brand: "samsung", model: "SM-G991B", imei: "356938035643809", serialno: "RF8N12ABCDE", android_id: "9a1b2c3d4e5f6a7b", gsf_id: "3a4b5c6d7e8f", gaid: "12345678-1234-1234-1234-123456789012" },
      },
    };
  });

  function rootResult() {
    return async (req: { body: unknown }) => {
      const { image_ids = [] } = (req.body ?? {}) as { image_ids?: string[] };
      return { code: 200, message: "Success", data: { success: image_ids, fail: [], fail_reason: {} } };
    };
  }
  app.post("/api/v1/cloudPhone/batchRoot", rootResult());
  app.post("/api/v1/cloudPhone/openAdb", rootResult());
  app.post("/api/v1/cloudPhone/closeAdb", rootResult());

  app.post("/api/v1/cloudPhone/newPhone", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/share", async (req) => {
    const { share = [] } = (req.body ?? {}) as { share?: Array<{ image_ids?: string[] }> };
    const data: Record<string, string> = {};
    for (const s of share) for (const id of s.image_ids ?? []) data[id] = `https://share.duoplus.net/${id}`;
    return { code: 200, message: "Success", data };
  });
  app.post("/api/v1/cloudPhone/updateSharePassword", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudNumber/imageWriteSms", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/live", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/scan", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/command", async (req) => {
    const { image_ids } = (req.body ?? {}) as { image_ids?: string[] };
    if (image_ids) {
      const data: Record<string, { success: boolean; content: string; message: string }> = {};
      for (const id of image_ids) data[id] = { success: true, content: "ok", message: "ok" };
      return { code: 200, message: "Success", data };
    }
    return { code: 200, message: "Success", data: { success: true, content: "ok", message: "ok" } };
  });
  app.post("/api/v1/cloudPhone/linkUserList", async () => {
    return { code: 200, message: "Success", data: { list: [{ user_id: "u-1", nickname: "Alice" }, { user_id: "u-2", nickname: "Bob" }] } };
  });

  // --- Proxies ---
  const proxies = [
    { id: "px-1", name: "US-Residential", host: "104.16.0.1", port: 1080, user: "user1", area: "United States(US)" },
    { id: "px-2", name: "DE-Datacenter", host: "85.10.0.2", port: 1080, user: "user2", area: "Germany(DE)" },
    { id: "px-3", name: "JP-Mobile", host: "126.0.0.3", port: 1080, user: "user3", area: "Japan(JP)" },
  ];
  let proxySeq = 4;

  app.post("/api/v1/proxy/list", async (req) => {
    const { page = 1, pagesize = 10 } = (req.body ?? {}) as { page?: number; pagesize?: number };
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: proxies.slice(start, start + pagesize), page, pagesize, total: proxies.length, total_page: Math.ceil(proxies.length / pagesize) } };
  });
  app.post("/api/v1/proxy/add", async (req) => {
    const { proxy_list = [] } = (req.body ?? {}) as { proxy_list?: Array<{ host: string; port: number; user?: string; name?: string }> };
    const success = proxy_list.map((p, index) => {
      const id = `px-${proxySeq++}`;
      proxies.push({ id, name: p.name ?? `proxy-${id}`, host: p.host, port: p.port, user: p.user ?? "", area: "Unknown" });
      return { index, id };
    });
    return { code: 200, message: "Success", data: { success, fail: [] } };
  });
  app.post("/api/v1/proxy/delete", async (req) => {
    const { ids = [] } = (req.body ?? {}) as { ids?: string[] };
    const success: string[] = [];
    for (const id of ids) {
      const i = proxies.findIndex((p) => p.id === id);
      if (i >= 0) { proxies.splice(i, 1); success.push(id); }
    }
    return { code: 200, message: "Success", data: { success, fail: [] } };
  });
  app.post("/api/v1/proxy/refresh", async (req) => {
    const { ids = [] } = (req.body ?? {}) as { ids?: string[] };
    return { code: 200, message: "Success", data: { success: ids, fail: [] } };
  });
  app.post("/api/v1/proxy/update", async (req) => {
    const body = (req.body ?? {}) as { id?: string; host?: string; port?: number; user?: string; name?: string };
    const p = proxies.find((x) => x.id === body.id);
    if (p) {
      if (body.host !== undefined) p.host = body.host;
      if (body.port !== undefined) p.port = body.port;
      if (body.user !== undefined) p.user = body.user;
      if (body.name !== undefined) p.name = body.name;
    }
    return { code: 200, message: "Success", data: { message: "Success", result: [] } };
  });

  // --- Groups ---
  const groups = [
    { id: "grp-1", name: "US Warmup", sort: 0, remark: "fresh accounts", image_count: 4 },
    { id: "grp-2", name: "EU Pool", sort: 1, remark: "", image_count: 4 },
    { id: "grp-3", name: "Staging", sort: 2, remark: "do not ship", image_count: 4 },
  ];
  let groupSeq = 4;

  app.post("/api/v1/cloudPhone/groupList", async (req) => {
    const { page = 1 } = (req.body ?? {}) as { page?: number };
    const pagesize = 200;
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: groups.slice(start, start + pagesize), page, pagesize, total: groups.length, total_page: Math.ceil(groups.length / pagesize) } };
  });
  app.post("/api/v1/cloudPhone/createGroup", async (req) => {
    const { list = [] } = (req.body ?? {}) as { list?: Array<{ name: string; sort?: number; remark?: string }> };
    const success = list.map((g, index) => {
      const id = `grp-${groupSeq++}`;
      const created = { id, name: g.name, sort: g.sort ?? 0, remark: g.remark ?? "", image_count: 0 };
      groups.push(created);
      return { index, id, name: created.name, sort: created.sort, remark: created.remark };
    });
    return { code: 200, message: "Success", data: { success, fail: [] } };
  });
  app.post("/api/v1/cloudPhone/updateGroup", async (req) => {
    const { list = [] } = (req.body ?? {}) as { list?: Array<{ id: string; name: string; sort?: number; remark?: string }> };
    const success = list.map((g, index) => {
      const existing = groups.find((x) => x.id === g.id);
      if (existing) {
        existing.name = g.name;
        if (g.sort !== undefined) existing.sort = g.sort;
        if (g.remark !== undefined) existing.remark = g.remark;
      }
      return { index, id: g.id, name: g.name, sort: g.sort ?? 0, remark: g.remark ?? "" };
    });
    return { code: 200, message: "Success", data: { success, fail: [] } };
  });
  app.post("/api/v1/cloudPhone/deleteGroup", async (req) => {
    const { ids = [] } = (req.body ?? {}) as { ids?: string[] };
    const success: string[] = [];
    for (const id of ids) {
      const i = groups.findIndex((g) => g.id === id);
      if (i >= 0) { groups.splice(i, 1); success.push(id); }
    }
    return { code: 200, message: "Success", data: { success, fail: [] } };
  });
  app.post("/api/v1/cloudPhone/addToGroup", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudPhone/moveToGroup", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });

  // --- Applications ---
  const platformApps = [
    { id: "app-1", name: "Google Chrome", pkg: "com.android.chrome", version_list: [{ id: "av-1", name: "120.0.6099" }, { id: "av-2", name: "119.0.6045" }] },
    { id: "app-2", name: "WhatsApp", pkg: "com.whatsapp", version_list: [{ id: "av-3", name: "2.24.5.78" }] },
    { id: "app-3", name: "TikTok", pkg: "com.zhiliaoapp.musically", version_list: [{ id: "av-4", name: "33.5.4" }] },
    { id: "app-4", name: "Instagram", pkg: "com.instagram.android", version_list: [{ id: "av-5", name: "318.0.0" }] },
  ];
  const teamApps = [
    { id: "tapp-1", name: "Acme Automation", pkg: "com.acme.automation", version_list: [{ id: "tav-1", name: "1.4.0" }] },
    { id: "tapp-2", name: "Acme Warmup", pkg: "com.acme.warmup", version_list: [{ id: "tav-2", name: "0.9.2" }] },
  ];

  function appListHandler(items: typeof platformApps) {
    return async (req: { body: unknown }) => {
      const { page = 1, pagesize = 10 } = (req.body ?? {}) as { page?: number; pagesize?: number };
      const start = (page - 1) * pagesize;
      return { code: 200, message: "Success", data: { list: items.slice(start, start + pagesize), page, pagesize, total: items.length, total_page: Math.ceil(items.length / pagesize) } };
    };
  }
  app.post("/api/v1/app/list", appListHandler(platformApps));
  app.post("/api/v1/app/teamList", appListHandler(teamApps));
  app.post("/api/v1/app/install", async () => {
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/uninstall", async () => {
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/start", async () => {
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/stop", async () => {
    return { code: 200, message: "Success", data: { message: "success" } };
  });
  app.post("/api/v1/app/installedList", async () => {
    return { code: 200, message: "Success", data: { list: ["com.android.chrome", "com.whatsapp"] } };
  });

  // --- Cloud Drive ---
  const driveFiles = [
    { id: "file-1", name: "promo.mp4", original_file_name: "summer-promo-final.mp4" },
    { id: "file-2", name: "warmup.apk", original_file_name: "acme-warmup-0.9.2.apk" },
    { id: "file-3", name: "avatar.png", original_file_name: "profile-avatar.png" },
  ];

  app.post("/api/v1/cloudDisk/list", async (req) => {
    const { keyword = "", page = 1, pagesize = 10 } = (req.body ?? {}) as { keyword?: string; page?: number; pagesize?: number };
    const filtered = keyword
      ? driveFiles.filter((f) => f.name.includes(keyword) || f.original_file_name.includes(keyword))
      : driveFiles;
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: filtered.slice(start, start + pagesize), page, pagesize, total: filtered.length, total_page: Math.ceil(filtered.length / pagesize) } };
  });
  app.post("/api/v1/cloudDisk/pushFiles", async () => {
    return { code: 200, message: "Success", data: { message: "Success", success: [], fail: [] } };
  });
  app.post("/api/v1/cloudDisk/delFiles", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/cloudDisk/signedUrl", async (req) => {
    const { name = "upload.bin" } = (req.body ?? {}) as { name?: string };
    // Point the signed PUT URL back at this mock server's own __oss_put endpoint
    // so the proxy's server-side OSS PUT can complete the full upload flow.
    const signedUrl = `${req.protocol}://${req.hostname}/__oss_put`;
    return { code: 200, message: "Success", data: { method: "PUT", signedUrl, headers: { "x-oss-callback": "eyJjYWxsYmFjayI6Ii4uLiJ9", "x-oss-callback-var": "eyJ4OnZhciI6Ii4uLiJ9" }, name, original_file_name: name } };
  });
  // Mock Alibaba OSS PUT target — accepts the raw bytes and returns 200.
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.put("/__oss_put", async (_req, reply) => reply.status(200).send("ok"));

  // --- Automation ---
  const customTemplates = [
    { id: "tpl-1", name: "Account Warmup", desc: "Daily scroll + like routine" },
    { id: "tpl-2", name: "Profile Setup", desc: "Fill bio, avatar, first post" },
    { id: "tpl-3", name: "DM Outreach", desc: "Send templated direct messages" },
  ];
  const officialTemplates = [
    { id: "otpl-1", name: "TikTok Warmup", desc: "Official TikTok warmup flow" },
    { id: "otpl-2", name: "Instagram Engage", desc: "Official IG engagement flow" },
  ];

  function templateListHandler(items: typeof customTemplates) {
    return async (req: { body: unknown }) => {
      const { page = 1, pagesize = 10, name = "" } = (req.body ?? {}) as { page?: number; pagesize?: number; name?: string };
      const filtered = name ? items.filter((t) => t.name.includes(name)) : items;
      const start = (page - 1) * pagesize;
      return { code: 200, message: "Success", data: { list: filtered.slice(start, start + pagesize), page, pagesize, total: filtered.length, total_page: Math.ceil(filtered.length / pagesize) } };
    };
  }
  app.post("/api/v1/automation/userTemplateList", templateListHandler(customTemplates));
  app.post("/api/v1/automation/officialTemplateList", templateListHandler(officialTemplates));

  const scheduledTasks = [
    { id: "task-1", name: "Morning warmup", task_type_name: "Account Warmup", image_name: "P1", ip: "104.16.0.1", status: 1, issue_at: "2026-06-15 09:00:00", created_at: "2026-06-14 08:00:00" },
    { id: "task-2", name: "Evening outreach", task_type_name: "DM Outreach", image_name: "P2", ip: "85.10.0.2", status: 0, issue_at: "2026-06-15 18:00:00", created_at: "2026-06-14 08:05:00" },
  ];
  app.post("/api/v1/automation/taskList", async (req) => {
    const { page = 1, pagesize = 10 } = (req.body ?? {}) as { page?: number; pagesize?: number };
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: scheduledTasks.slice(start, start + pagesize), page, pagesize, total: scheduledTasks.length, total_page: Math.ceil(scheduledTasks.length / pagesize) } };
  });

  const loopTasks = [
    { id: "plan-1", name: "Hourly engagement", remark: "every 60m", task_type_name: "Account Warmup", status: 1, created_at: "2026-06-14 08:00:00" },
    { id: "plan-2", name: "Daily post", remark: "9am daily", task_type_name: "Profile Setup", status: 0, created_at: "2026-06-14 08:10:00" },
  ];
  let planSeq = 3;
  app.post("/api/v1/automation/planList", async (req) => {
    const { page = 1, pagesize = 10, name = "" } = (req.body ?? {}) as { page?: number; pagesize?: number; name?: string };
    const filtered = name ? loopTasks.filter((t) => t.name.includes(name)) : loopTasks;
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: filtered.slice(start, start + pagesize), page, pagesize, total: filtered.length, total_page: Math.ceil(filtered.length / pagesize) } };
  });
  app.post("/api/v1/automation/addTask", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/automation/addPlan", async (req) => {
    const { name = "New plan" } = (req.body ?? {}) as { name?: string };
    const id = `plan-${planSeq++}`;
    loopTasks.push({ id, name, remark: "", task_type_name: "Account Warmup", status: 1, created_at: new Date().toISOString() });
    return { code: 200, message: "Success", data: { id } };
  });
  app.post("/api/v1/automation/savePlan", async (req) => {
    const { id = "plan-1" } = (req.body ?? {}) as { id?: string };
    return { code: 200, message: "Success", data: { id } };
  });
  app.post("/api/v1/automation/setPlanStatus", async (req) => {
    const { id, status } = (req.body ?? {}) as { id?: string; status?: number };
    const plan = loopTasks.find((p) => p.id === id);
    if (plan && status !== undefined) plan.status = status;
    return { code: 200, message: "Success", data: { id } };
  });
  app.post("/api/v1/automation/deletePlan", async (req) => {
    const { id } = (req.body ?? {}) as { id?: string };
    const i = loopTasks.findIndex((p) => p.id === id);
    if (i >= 0) loopTasks.splice(i, 1);
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/automation/taskLogList", async () => {
    return {
      code: 200,
      message: "Success",
      data: {
        list: [
          { id: "log-1", result_info: { action: "openApp", result: true }, start_at: "2026-06-15 09:00:00", finish_at: "2026-06-15 09:00:05", created_at: "2026-06-15 09:00:00" },
          { id: "log-2", result_info: { action: "scrollFeed", result: true }, start_at: "2026-06-15 09:00:05", finish_at: "2026-06-15 09:01:30", created_at: "2026-06-15 09:00:05" },
        ],
      },
    };
  });
  app.post("/api/v1/automation/setTaskStatus", async (req) => {
    const { ids = [] } = (req.body ?? {}) as { ids?: string[] };
    return { code: 200, message: "Success", data: { success: ids, fail: [], fail_reason: {} } };
  });
  app.post("/api/v1/automation/updateTaskTime", async () => {
    return { code: 200, message: "Success", data: { message: "Success" } };
  });

  // --- Cloud Numbers ---
  const cloudNumbers = [
    { id: "num-1", phone_number: "+15551230001", region_name: "United States", type_name: "Mobile", status_name: "On", renewal_status: 1, remark: "WhatsApp line", created_at: "2026-05-01 10:00:00", expired_at: "2026-07-01 10:00:00" },
    { id: "num-2", phone_number: "+447700900002", region_name: "United Kingdom", type_name: "Mobile", status_name: "On", renewal_status: 0, remark: "", created_at: "2026-05-10 14:30:00", expired_at: "2026-06-20 14:30:00" },
    { id: "num-3", phone_number: "+819012340003", region_name: "Japan", type_name: "Virtual", status_name: "Expired", renewal_status: 0, remark: "old", created_at: "2026-03-01 09:00:00", expired_at: "2026-05-01 09:00:00" },
  ];
  const smsByNumber: Record<string, Array<{ message: string; code: string; received_at: string }>> = {
    "num-1": [
      { message: "Your WhatsApp code is 482913. Do not share it.", code: "482913", received_at: "2026-06-14 11:02:00" },
      { message: "Telegram code: 77104", code: "77104", received_at: "2026-06-13 18:45:00" },
    ],
    "num-2": [
      { message: "G-558210 is your Google verification code.", code: "558210", received_at: "2026-06-12 08:15:00" },
    ],
    "num-3": [],
  };

  app.post("/api/v1/cloudNumber/numberList", async (req) => {
    const { page = 1, pagesize = 10 } = (req.body ?? {}) as { page?: number; pagesize?: number };
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: cloudNumbers.slice(start, start + pagesize), page, pagesize, total: cloudNumbers.length, total_page: Math.ceil(cloudNumbers.length / pagesize) } };
  });
  app.post("/api/v1/cloudNumber/smsList", async (req) => {
    const { number_id, page = 1, pagesize = 10 } = (req.body ?? {}) as { number_id?: string; page?: number; pagesize?: number };
    const all = smsByNumber[number_id ?? ""] ?? [];
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: all.slice(start, start + pagesize), page, pagesize, total: all.length, total_page: Math.ceil(all.length / pagesize) } };
  });
  app.post("/api/v1/cloudNumber/package", async () => {
    return { code: 200, message: "Success", data: { duration: ["30", "90", "180", "360"] } };
  });
  app.post("/api/v1/cloudNumber/renewalPackage", async (req) => {
    const { number_ids = [] } = (req.body ?? {}) as { number_ids?: string[] };
    const numbers = cloudNumbers.filter((n) => number_ids.includes(n.id)).map((n) => ({ id: n.id, phone_number: n.phone_number, expired_at: n.expired_at, duration: [30, 90, 180] }));
    return { code: 200, message: "Success", data: { numbers } };
  });
  app.post("/api/v1/cloudNumber/purchase", async () => {
    return { code: 200, message: "Success", data: { order_id: `ord-num-${Date.now()}` } };
  });
  app.post("/api/v1/cloudNumber/renewal", async () => {
    return { code: 200, message: "Success", data: { order_id: `ord-num-renew-${Date.now()}` } };
  });

  // --- Account / Orders + Subscriptions ---
  const orders = [
    { type: "Cloud Phone", order_id: "ord-1001", product: "Android 15", description: "30 days x 2", status: "Paid", total: "19.98", created_at: "2026-06-01 10:00:00", expired_at: "2026-07-01 10:00:00", expired_seconds: 0 },
    { type: "Cloud Number", order_id: "ord-1002", product: "US Mobile Number", description: "90 days x 1", status: "Paid", total: "8.99", created_at: "2026-05-20 09:30:00", expired_at: "2026-08-18 09:30:00", expired_seconds: 0 },
  ];
  app.post("/api/v1/team/order", async (req) => {
    const { page = 1, pagesize = 10 } = (req.body ?? {}) as { page?: number; pagesize?: number };
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: orders.slice(start, start + pagesize), page, pagesize, total: orders.length, total_page: Math.ceil(orders.length / pagesize) } };
  });

  const subscriptions = [
    { id: "sub-1", name: "Starter Plan", cpu: "4 vCPU", ram: "8G", rom: "64G", renewal_status: 1, free_status: 1, remark: "team default", expired_at: "2026-07-15 00:00:00", created_at: "2026-06-15 00:00:00", need_renewal: false },
    { id: "sub-2", name: "Pro Plan", cpu: "8 vCPU", ram: "16G", rom: "128G", renewal_status: 0, free_status: 1, remark: "", expired_at: "2026-06-20 00:00:00", created_at: "2026-05-20 00:00:00", need_renewal: true },
  ];
  app.post("/api/v1/subscriptionStartup/list", async (req) => {
    const { free_status, page = 1, pagesize = 10 } = (req.body ?? {}) as { free_status?: number; page?: number; pagesize?: number };
    const filtered = free_status !== undefined ? subscriptions.filter((s) => s.free_status === free_status) : subscriptions;
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: filtered.slice(start, start + pagesize), page, pagesize, total: filtered.length, total_page: Math.ceil(filtered.length / pagesize) } };
  });
  app.post("/api/v1/subscriptionStartup/purchase", async () => {
    return { code: 200, message: "Success", data: { order_id: `ord-sub-${Date.now()}` } };
  });
  app.post("/api/v1/subscriptionStartup/renewal", async () => {
    return { code: 200, message: "Success", data: { order_id: `ord-sub-renew-${Date.now()}` } };
  });

  // --- Reference data ---
  app.post("/api/v1/mobile/modelList", async () => {
    return { code: 200, message: "Success", data: { Samsung: { m1: { name: "Galaxy S23" }, m2: { name: "Galaxy S24" } }, Google: { m3: { name: "Pixel 8" } } } };
  });
  app.post("/api/v1/cloudPhone/cloudPhone", async () => {
    return {
      code: 200,
      message: "Success",
      data: {
        list: [
          { name: "US", region_id: "r1", os: "Android 15", count: 10, used_count: 3 },
          { name: "EU", region_id: "r2", os: "Android 12 (Region A)", count: 6, used_count: 1 },
          { name: "JP", region_id: "r3", os: "Android 11", count: 4, used_count: 4 },
        ],
      },
    };
  });
  app.post("/api/v1/cloudPhone/resolutionList", async () => {
    return { code: 200, message: "Success", data: { list: ["720x1280(320dpi)", "1080x1920(480dpi)", "1440x2560(560dpi)"] } };
  });
  const tags = [
    { id: "tag-1", name: "warmup", color: "#22c55e", image_count: 12 },
    { id: "tag-2", name: "outreach", color: "#3b82f6", image_count: 5 },
    { id: "tag-3", name: "staging", color: "#f59e0b", image_count: 3 },
  ];
  app.post("/api/v1/cloudPhone/tagList", async (req) => {
    const { name = "", page = 1, pagesize = 10 } = (req.body ?? {}) as { name?: string; page?: number; pagesize?: number };
    const filtered = name ? tags.filter((t) => t.name.includes(name)) : tags;
    const start = (page - 1) * pagesize;
    return { code: 200, message: "Success", data: { list: filtered.slice(start, start + pagesize), page, pagesize, total: filtered.length, total_page: Math.ceil(filtered.length / pagesize) } };
  });

  // --- Buy / Renew / Modify ---
  app.post("/api/v1/cloudPhone/purchase", async () => {
    return { code: 200, message: "Success", data: { order_id: `ord-buy-${Date.now()}` } };
  });
  app.post("/api/v1/cloudPhone/renewal", async () => {
    return { code: 200, message: "Success", data: { order_id: `ord-renew-${Date.now()}` } };
  });
  app.post("/api/v1/cloudPhone/update", async (req) => {
    const { images = [] } = (req.body ?? {}) as { images?: Array<{ image_id: string }> };
    return { code: 200, message: "Success", data: { success: images.map((i) => i.image_id), fail: [], fail_reason: {} } };
  });

  return app;
}
