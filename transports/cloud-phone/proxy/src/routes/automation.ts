import type { FastifyInstance } from "fastify";
import type { Paginated, Template, ScheduledTask, LoopTask } from "@duoplus/shared";
import type { Caller } from "../core.js";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function registerAutomationRoutes(app: FastifyInstance, call: Caller) {
  app.get("/api/automation/templates", async (req) => {
    const q = req.query as { type?: string; page?: string; pageSize?: string; name?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const path = q.type === "official"
      ? "/api/v1/automation/officialTemplateList"
      : "/api/v1/automation/userTemplateList";
    const data = await call<{ list: Template[]; total: number }>(path, { name: q.name, page, pagesize: pageSize });
    const out: Paginated<Template> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.get("/api/automation/scheduled", async (req) => {
    const q = req.query as { issueStart?: string; issueEnd?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const now = new Date();
    const issueEnd = q.issueEnd ?? fmt(now);
    const issueStart = q.issueStart ?? fmt(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const data = await call<{ list: ScheduledTask[]; total: number }>("/api/v1/automation/taskList", {
      issue_at_start: issueStart,
      issue_at_end: issueEnd,
      page,
      pagesize: pageSize,
    });
    const out: Paginated<ScheduledTask> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.get("/api/automation/loop", async (req) => {
    const q = req.query as { page?: string; pageSize?: string; name?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const data = await call<{ list: LoopTask[]; total: number }>("/api/v1/automation/planList", { name: q.name, page, pagesize: pageSize });
    const out: Paginated<LoopTask> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.post("/api/automation/scheduled", async (req) => {
    return call("/api/v1/automation/addTask", req.body);
  });

  app.post("/api/automation/loop", async (req) => {
    return call("/api/v1/automation/addPlan", req.body);
  });

  app.post("/api/automation/loop/save", async (req) => {
    return call("/api/v1/automation/savePlan", req.body);
  });

  app.post("/api/automation/loop/status", async (req) => {
    const body = req.body as { id: string; status: number };
    return call("/api/v1/automation/setPlanStatus", body);
  });

  app.post("/api/automation/loop/delete", async (req) => {
    const body = req.body as { id: string };
    return call("/api/v1/automation/deletePlan", body);
  });

  app.get("/api/automation/report", async (req) => {
    const q = req.query as { taskId?: string; cursorId?: string };
    return call("/api/v1/automation/taskLogList", { task_id: q.taskId, cursor_id: q.cursorId });
  });

  app.post("/api/automation/scheduled/status", async (req) => {
    const body = req.body as { ids: string[]; status: number };
    return call("/api/v1/automation/setTaskStatus", body);
  });

  app.post("/api/automation/scheduled/time", async (req) => {
    const body = req.body as { id: string; issue_at: string };
    return call("/api/v1/automation/updateTaskTime", body);
  });
}
