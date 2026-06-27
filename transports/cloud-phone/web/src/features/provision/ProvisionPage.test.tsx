import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { ProvisionPage } from "./ProvisionPage";
import React from "react";

let buyBody: unknown = null;
const buySpy = http.post("/api/phones/buy", async ({ request }) => {
  buyBody = await request.json();
  return HttpResponse.json({ order_id: "ord-buy-99" });
});

const server = setupServer(buySpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); buyBody = null; });
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProvisionPage /></QueryClientProvider>);
}

describe("ProvisionPage", () => {
  it("shows reference resources and resolutions", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("7 / 10")).toBeInTheDocument());
    expect(screen.getByText("US")).toBeInTheDocument();
    expect(screen.getByText("720x1280(320dpi)")).toBeInTheDocument();
  });

  it("buys phones and shows the returned order id", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /^buy$/i }));
    await waitFor(() => expect(screen.getByText("ord-buy-99")).toBeInTheDocument());
    expect(buyBody).toMatchObject({ os: "15", duration: 30, quantity: 1 });
  });
});
