import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../test/mswHandlers";
import { ProxiesPage } from "./ProxiesPage";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProxiesPage /></QueryClientProvider>);
}

describe("ProxiesPage", () => {
  it("renders proxies from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("US-Residential")).toBeInTheDocument());
    expect(screen.getByText("104.16.0.1:1080")).toBeInTheDocument();
  });

  it("adds a proxy via the form", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("US-Residential");
    await user.type(screen.getByPlaceholderText("1.2.3.4"), "9.9.9.9");
    await user.click(screen.getByRole("button", { name: /add proxy/i }));
    expect(await screen.findByText(/Added 1, failed 0/)).toBeInTheDocument();
  });
});
