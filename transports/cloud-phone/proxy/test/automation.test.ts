import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";

function fakeUpstream(): { app: FastifyInstance; calls: Record<string, unknown> } {
  const app = Fastify();
  const calls: Record<string, unknown> = {};

  app.post("/api/v1/automation/userTemplateList", async (req) => {
    calls["automation/userTemplateList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "tpl-1", name: "Custom Warmup", desc: "custom" }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/automation/officialTemplateList", async (req) => {
    calls["automation/officialTemplateList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "otpl-1", name: "Official Warmup", desc: "official" }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/automation/taskList", async (req) => {
    calls["automation/taskList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "task-1", name: "Daily warmup", task_type_name: "Warmup", image_name: "P1", ip: "1.1.1.1", status: 1, issue_at: "2026-06-15 10:00:00", created_at: "2026-06-14 09:00:00" }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/automation/planList", async (req) => {
    calls["automation/planList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "plan-1", name: "Loop warmup", remark: "", task_type_name: "Warmup", status: 1, created_at: "2026-06-14 09:00:00" }], page: 1, pagesize: 20, total: 1 } };
  });
  app.post("/api/v1/automation/addTask", async (req) => {
    calls["automation/addTask"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/automation/addPlan", async (req) => {
    calls["automation/addPlan"] = req.body;
    return { code: 200, message: "Success", data: { id: "plan-new" } };
  });
  app.post("/api/v1/automation/savePlan", async (req) => {
    calls["automation/savePlan"] = req.body;
    return { code: 200, message: "Success", data: { id: "plan-1" } };
  });
  app.post("/api/v1/automation/setPlanStatus", async (req) => {
    calls["automation/setPlanStatus"] = req.body;
    return { code: 200, message: "Success", data: { id: "plan-1" } };
  });
  app.post("/api/v1/automation/deletePlan", async (req) => {
    calls["automation/deletePlan"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });
  app.post("/api/v1/automation/taskLogList", async (req) => {
    calls["automation/taskLogList"] = req.body;
    return { code: 200, message: "Success", data: { list: [{ id: "log-1", result_info: { action: "open", result: true }, start_at: "2026-06-15 10:00:00", finish_at: "2026-06-15 10:01:00", created_at: "2026-06-15 10:00:00" }] } };
  });
  app.post("/api/v1/automation/setTaskStatus", async (req) => {
    calls["automation/setTaskStatus"] = req.body;
    return { code: 200, message: "Success", data: { success: ["task-1"], fail: [], fail_reason: {} } };
  });
  app.post("/api/v1/automation/updateTaskTime", async (req) => {
    calls["automation/updateTaskTime"] = req.body;
    return { code: 200, message: "Success", data: { message: "Success" } };
  });

  return { app, calls };
}

describe("proxy automation routes", () => {
  let upstream: FastifyInstance; let baseUrl: string; let calls: Record<string, unknown>;
  beforeEach(async () => {
    const u = fakeUpstream();
    upstream = u.app; calls = u.calls;
    await upstream.listen({ port: 0 });
    const addr = upstream.server.address();
    baseUrl = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterEach(async () => { await upstream.close(); });

  function makeApp() {
    return buildApp(loadConfig({ DUOPLUS_BASE_URL: baseUrl } as NodeJS.ProcessEnv));
  }

  it("GET templates?type=custom hits userTemplateList", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/automation/templates?type=custom" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ id: "tpl-1" });
    expect(calls["automation/userTemplateList"]).toBeDefined();
    expect(calls["automation/officialTemplateList"]).toBeUndefined();
  });

  it("GET templates?type=official hits officialTemplateList", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/automation/templates?type=official" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ id: "otpl-1" });
    expect(calls["automation/officialTemplateList"]).toBeDefined();
    expect(calls["automation/userTemplateList"]).toBeUndefined();
  });

  it("GET scheduled defaults a date range when none provided", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/automation/scheduled" });
    expect(res.statusCode).toBe(200);
    const sent = calls["automation/taskList"] as { issue_at_start?: string; issue_at_end?: string };
    expect(sent.issue_at_start).toBeTruthy();
    expect(sent.issue_at_end).toBeTruthy();
    expect(sent.issue_at_start).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(sent.issue_at_end).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("GET scheduled forwards provided date range", async () => {
    await makeApp().inject({ method: "GET", url: "/api/automation/scheduled?issueStart=2026-01-01 00:00:00&issueEnd=2026-02-01 00:00:00" });
    expect(calls["automation/taskList"]).toMatchObject({ issue_at_start: "2026-01-01 00:00:00", issue_at_end: "2026-02-01 00:00:00" });
  });

  it("GET loop hits planList", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/automation/loop" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ id: "plan-1" });
    expect(calls["automation/planList"]).toBeDefined();
  });

  it("POST scheduled forwards body to addTask", async () => {
    await makeApp().inject({ method: "POST", url: "/api/automation/scheduled", payload: { template_id: "tpl-1", template_type: 1, name: "x", images: [] } });
    expect(calls["automation/addTask"]).toMatchObject({ template_id: "tpl-1", name: "x" });
  });

  it("POST loop forwards body to addPlan", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/automation/loop", payload: { template_id: "tpl-1", template_type: 1, name: "x", images: [] } });
    expect(res.json()).toMatchObject({ id: "plan-new" });
    expect(calls["automation/addPlan"]).toMatchObject({ template_id: "tpl-1", name: "x" });
  });

  it("POST loop/save forwards body to savePlan", async () => {
    await makeApp().inject({ method: "POST", url: "/api/automation/loop/save", payload: { id: "plan-1", name: "y" } });
    expect(calls["automation/savePlan"]).toMatchObject({ id: "plan-1", name: "y" });
  });

  it("POST loop/status forwards {id,status} to setPlanStatus", async () => {
    const res = await makeApp().inject({ method: "POST", url: "/api/automation/loop/status", payload: { id: "plan-1", status: 0 } });
    expect(res.json()).toMatchObject({ id: "plan-1" });
    expect(calls["automation/setPlanStatus"]).toMatchObject({ id: "plan-1", status: 0 });
  });

  it("POST loop/delete forwards {id} to deletePlan", async () => {
    await makeApp().inject({ method: "POST", url: "/api/automation/loop/delete", payload: { id: "plan-1" } });
    expect(calls["automation/deletePlan"]).toMatchObject({ id: "plan-1" });
  });

  it("GET report forwards {task_id,cursor_id} and returns list", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/automation/report?taskId=task-1&cursorId=c-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().list[0]).toMatchObject({ id: "log-1" });
    expect(calls["automation/taskLogList"]).toMatchObject({ task_id: "task-1", cursor_id: "c-1" });
  });

  it("POST scheduled/status forwards {ids,status} to setTaskStatus", async () => {
    await makeApp().inject({ method: "POST", url: "/api/automation/scheduled/status", payload: { ids: ["task-1"], status: 5 } });
    expect(calls["automation/setTaskStatus"]).toMatchObject({ ids: ["task-1"], status: 5 });
  });

  it("POST scheduled/time forwards {id,issue_at} to updateTaskTime", async () => {
    await makeApp().inject({ method: "POST", url: "/api/automation/scheduled/time", payload: { id: "task-1", issue_at: "2026-06-20 10:00:00" } });
    expect(calls["automation/updateTaskTime"]).toMatchObject({ id: "task-1", issue_at: "2026-06-20 10:00:00" });
  });
});
