import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../test/mswHandlers";
import { OrdersPage } from "./OrdersPage";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrdersPage /></QueryClientProvider>);
}

describe("OrdersPage", () => {
  it("renders order history from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("ord-1001")).toBeInTheDocument());
    expect(screen.getByText("Android 15")).toBeInTheDocument();
    expect(screen.getByText("19.98")).toBeInTheDocument();
  });
});
