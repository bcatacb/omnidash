import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../test/mswHandlers";
import {
  listTemplates, listScheduled, listLoop, createLoop, setLoopStatus, deleteLoop,
  getReport, setScheduledStatus, updateScheduledTime,
} from "./automation";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("automation api", () => {
  it("listTemplates custom returns typed paginated data", async () => {
    const res = await listTemplates({ type: "custom", page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ id: "tpl-1", name: "Account Warmup" });
  });

  it("listTemplates official returns the official template", async () => {
    const res = await listTemplates({ type: "official", page: 1, pageSize: 20 });
    expect(res.items[0]).toMatchObject({ id: "otpl-1" });
  });

  it("listScheduled returns task list", async () => {
    const res = await listScheduled({ page: 1, pageSize: 20 });
    expect(res.items[0]).toMatchObject({ id: "task-1", status: 1 });
  });

  it("listLoop returns plan list", async () => {
    const res = await listLoop({ page: 1, pageSize: 20 });
    expect(res.items[0]).toMatchObject({ id: "plan-1" });
  });

  it("createLoop returns id", async () => {
    const res = await createLoop({ template_id: "tpl-1", name: "x", images: [] });
    expect(res.id).toBe("plan-new");
  });

  it("setLoopStatus forwards id", async () => {
    const res = await setLoopStatus({ id: "plan-1", status: 0 });
    expect(res.id).toBe("plan-1");
  });

  it("deleteLoop returns message", async () => {
    const res = await deleteLoop("plan-1");
    expect(res.message).toBe("Success");
  });

  it("getReport returns log list", async () => {
    const res = await getReport({ taskId: "task-1" });
    expect(res.list[0]).toMatchObject({ id: "log-1" });
  });

  it("setScheduledStatus returns success", async () => {
    const res = await setScheduledStatus({ ids: ["task-1"], status: 5 });
    expect(res.success).toEqual(["task-1"]);
  });

  it("updateScheduledTime returns message", async () => {
    const res = await updateScheduledTime({ id: "task-1", issue_at: "2026-06-20 10:00:00" });
    expect(res.message).toBe("Success");
  });
});
