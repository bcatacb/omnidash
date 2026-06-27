import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { AppsPage } from "./AppsPage";
import React from "react";

let installBody: { image_ids: string[]; app_id: string } | null = null;
const installSpy = http.post("/api/apps/install", async ({ request }) => {
  installBody = (await request.json()) as { image_ids: string[]; app_id: string };
  return HttpResponse.json({ message: "success" });
});

const server = setupServer(installSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); installBody = null; });
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AppsPage /></QueryClientProvider>);
}

describe("AppsPage", () => {
  it("renders platform apps from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Google Chrome")).toBeInTheDocument());
    expect(screen.getByText("com.android.chrome")).toBeInTheDocument();
  });

  it("installs an app to the entered phone ids with {image_ids,app_id}", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Google Chrome");
    await user.type(screen.getByLabelText(/target phone ids/i), "cp-1, cp-2");
    await user.click(screen.getByRole("button", { name: /^install app-1$/i }));
    const dialog = await screen.findByRole("dialog", { name: /install app/i });
    await user.click(within(dialog).getByRole("button", { name: /^install$/i }));
    await waitFor(() => expect(installBody).toEqual({ image_ids: ["cp-1", "cp-2"], app_id: "app-1", app_version_id: "av-1" }));
  });

  it("switches to the team tab", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Google Chrome");
    await user.click(screen.getByRole("button", { name: /^team$/i }));
    await waitFor(() => expect(screen.getByText("Acme Automation")).toBeInTheDocument());
  });
});
