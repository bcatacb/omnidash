import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../test/mswHandlers";
import { GroupsPage } from "./GroupsPage";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><GroupsPage /></QueryClientProvider>);
}

describe("GroupsPage", () => {
  it("renders groups from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("US Warmup")).toBeInTheDocument());
    expect(screen.getByText("fresh accounts")).toBeInTheDocument();
  });

  it("creates a group via the form", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("US Warmup");
    await user.type(screen.getByPlaceholderText("Group name"), "New Group");
    await user.click(screen.getByRole("button", { name: /create group/i }));
    expect(await screen.findByText(/Created 1, failed 0/)).toBeInTheDocument();
  });
});
