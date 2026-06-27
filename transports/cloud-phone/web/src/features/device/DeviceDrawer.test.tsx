import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { DeviceDrawer } from "./DeviceDrawer";
import type { CloudPhone } from "@duoplus/shared";
import React from "react";

const phone: CloudPhone = {
  id: "cp-1", name: "P1", powerState: "on", statusCode: 1, os: "Android 15", size: "8G",
  area: "US", ip: "1.1.1.1", group: "US Pool", adb: "1.1.1.1:5", remark: "Password: y", createdAt: "1", expiredAt: "2",
};

let adbBody: { image_id?: string; command: string } | null = null;
const adbSpy = http.post("/api/phones/adb", async ({ request }) => {
  adbBody = (await request.json()) as { image_id?: string; command: string };
  return HttpResponse.json({ success: true, content: "device-info-ok", message: "ok" });
});

const server = setupServer(adbSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); adbBody = null; });
afterAll(() => server.close());

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeviceDrawer phone={phone} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("DeviceDrawer", () => {
  it("shows overview and masks remark until revealed", async () => {
    renderDrawer();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText(/US Pool/)).toBeInTheDocument();
    expect(screen.queryByText(/Password: y/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(/Password: y/)).toBeInTheDocument();
  });

  it("Details tab lazily fetches and shows device info", async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => expect(screen.getByText("SM-G991B")).toBeInTheDocument());
    expect(screen.getByText("104.16.0.1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("ADB tab runs a command with image_id and shows output", async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole("tab", { name: "ADB" }));
    await user.type(screen.getByRole("textbox", { name: /adb command/i }), "getprop");
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => expect(adbBody).toEqual({ image_id: "cp-1", command: "getprop" }));
    await waitFor(() => expect(screen.getByLabelText("adb output")).toHaveTextContent("device-info-ok"));
  });
});
