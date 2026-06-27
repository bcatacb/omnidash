import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { useFleetStore } from "../../store/fleetStore";
import { FleetPage } from "./FleetPage";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  const st = useFleetStore.getState();
  st.clearSelection();
  st.setSearch("");
  st.setStatusFilter("all");
});
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><FleetPage /></QueryClientProvider>);
}

describe("FleetPage", () => {
  it("renders phones from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("P1")).toBeInTheDocument());
  });

  it("enables batch bar after selecting a phone", async () => {
    renderPage();
    await waitFor(() => screen.getByText("P1"));
    await userEvent.click(screen.getByRole("checkbox", { name: /select cp-1/i }));
    expect(screen.getByRole("button", { name: /power on/i })).toBeEnabled();
  });

  it("shows the batch power result summary after a power op", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("P1");
    await user.click(screen.getByRole("checkbox", { name: /select cp-1/i }));
    await user.click(screen.getByRole("button", { name: /power on/i }));
    expect(await screen.findByText(/1 ok, 0 failed/)).toBeInTheDocument();
  });

  it("filters visible rows by search", async () => {
    const two = [
      { id: "cp-1", name: "P1", powerState: "on", statusCode: 1, os: "Android 15", size: "8G", area: "US", ip: "1.1.1.1", group: "US Pool", adb: "", remark: "", createdAt: "1", expiredAt: "2" },
      { id: "cp-2", name: "Berlin", powerState: "off", statusCode: 2, os: "Android 15", size: "8G", area: "DE", ip: "2.2.2.2", group: "EU Pool", adb: "", remark: "", createdAt: "1", expiredAt: "2" },
    ];
    server.use(http.get("/api/phones", () => HttpResponse.json({ items: two, page: 1, pageSize: 20, total: 2 })));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("P1");
    expect(screen.getByText("Berlin")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/search fleet/i), "berlin");
    await waitFor(() => expect(screen.queryByText("P1")).not.toBeInTheDocument());
    expect(screen.getByText("Berlin")).toBeInTheDocument();
  });

  it("advances the page when Next is clicked", async () => {
    const pageParams: number[] = [];
    server.use(http.get("/api/phones", ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
      pageParams.push(page);
      const name = page === 1 ? "PageOne" : "PageTwo";
      return HttpResponse.json({ items: [{ id: `cp-${page}`, name, powerState: "on", statusCode: 1, os: "Android 15", size: "8G", area: "US", ip: "1.1.1.1", group: "US Pool", adb: "", remark: "", createdAt: "1", expiredAt: "2" }], page, pageSize: 20, total: 40 });
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("PageOne");
    expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText("PageTwo");
    expect(pageParams).toContain(2);
    expect(screen.getByText(/page 2 of 2/i)).toBeInTheDocument();
  });
});
