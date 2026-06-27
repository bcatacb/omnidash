import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../test/mswHandlers";
import { getModels, getResources, getResolutions, getTags } from "./reference";

let modelsUrl: URL | null = null;
const modelsSpy = http.get("/api/reference/models", ({ request }) => {
  modelsUrl = new URL(request.url);
  return HttpResponse.json({ Samsung: { m1: { name: "Galaxy S23" } } });
});

let tagsUrl: URL | null = null;
const tagsSpy = http.get("/api/reference/tags", ({ request }) => {
  tagsUrl = new URL(request.url);
  return HttpResponse.json({ items: [{ id: "tag-1", name: "warmup", color: "#22c55e", image_count: 12 }], page: 1, pageSize: 20, total: 1 });
});

const server = setupServer(modelsSpy, tagsSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); modelsUrl = null; tagsUrl = null; });
afterAll(() => server.close());

describe("reference api", () => {
  it("getModels forwards the os query param and returns nested data", async () => {
    const res = await getModels(4);
    expect(res.Samsung.m1.name).toBe("Galaxy S23");
    expect(modelsUrl?.searchParams.get("os")).toBe("4");
  });

  it("getResources returns the list", async () => {
    const res = await getResources();
    expect(res.list[0]).toMatchObject({ name: "US", region_id: "r1" });
  });

  it("getResolutions returns the list", async () => {
    const res = await getResolutions();
    expect(res.list).toContain("720x1280(320dpi)");
  });

  it("getTags returns paginated tags and forwards name", async () => {
    const res = await getTags({ name: "warm" });
    expect(res.items[0]).toMatchObject({ id: "tag-1", name: "warmup" });
    expect(tagsUrl?.searchParams.get("name")).toBe("warm");
  });
});
