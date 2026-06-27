import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { AutomationPage } from "./AutomationPage";
import React from "react";

let loopStatusBody: { id: string; status: number } | null = null;
const loopStatusSpy = http.post("/api/automation/loop/status", async ({ request }) => {
  loopStatusBody = (await request.json()) as { id: string; status: number };
  return HttpResponse.json({ id: loopStatusBody.id });
});

const server = setupServer(loopStatusSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); loopStatusBody = null; });
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AutomationPage /></QueryClientProvider>);
}

describe("AutomationPage", () => {
  it("templates tab shows items from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Account Warmup")).toBeInTheDocument());
    expect(screen.getByText("Daily scroll + like routine")).toBeInTheDocument();
  });

  it("toggles to official templates", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Account Warmup");
    await user.click(screen.getByRole("button", { name: /^official$/i }));
    await waitFor(() => expect(screen.getByText("TikTok Warmup")).toBeInTheDocument());
  });

  it("loop tab pause forwards {id,status:0}", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /^loop$/i }));
    await screen.findByText("Hourly engagement");
    await user.click(screen.getByRole("button", { name: /^pause plan-1$/i }));
    await waitFor(() => expect(loopStatusBody).toEqual({ id: "plan-1", status: 0 }));
  });
});
