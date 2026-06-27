import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { NumbersPage } from "./NumbersPage";
import React from "react";

let smsRequestedId: string | null = null;
const smsSpy = http.get("/api/numbers/:id/sms", ({ params }) => {
  smsRequestedId = String(params.id);
  return HttpResponse.json({ items: [{ message: "Your WhatsApp code is 482913", code: "482913", received_at: "2026-06-14 11:02:00" }], page: 1, pageSize: 20, total: 1 });
});

const server = setupServer(smsSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); smsRequestedId = null; });
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><NumbersPage /></QueryClientProvider>);
}

describe("NumbersPage", () => {
  it("renders cloud numbers from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("+15551230001")).toBeInTheDocument());
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("opens the SMS drawer for the clicked number and shows the code", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("+15551230001");
    await user.click(screen.getByRole("button", { name: /view sms num-1/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /sms messages/i })).toBeInTheDocument());
    expect(await screen.findByText("482913")).toBeInTheDocument();
    expect(smsRequestedId).toBe("num-1");
  });
});
