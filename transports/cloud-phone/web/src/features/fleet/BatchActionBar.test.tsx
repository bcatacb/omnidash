import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { useFleetStore } from "../../store/fleetStore";
import { BatchActionBar } from "./BatchActionBar";
import React from "react";

let moveBody: { id: string; image_ids: string[] } | null = null;
const moveSpy = http.post("/api/groups/move", async ({ request }) => {
  moveBody = (await request.json()) as { id: string; image_ids: string[] };
  return HttpResponse.json({ message: "Success" });
});

let installBody: { image_ids: string[]; app_id: string } | null = null;
const installSpy = http.post("/api/apps/install", async ({ request }) => {
  installBody = (await request.json()) as { image_ids: string[]; app_id: string };
  return HttpResponse.json({ message: "success" });
});

const server = setupServer(moveSpy, installSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); moveBody = null; installBody = null; useFleetStore.getState().clearSelection(); });
afterAll(() => server.close());

function renderBar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BatchActionBar params={{ page: 1, pageSize: 20 }} />
    </QueryClientProvider>,
  );
}

describe("BatchActionBar move-to-group", () => {
  it("moves selected phones to the chosen group with {id,image_ids}", async () => {
    const user = userEvent.setup();
    useFleetStore.getState().selectAll(["cp-1", "cp-2"]);
    renderBar();
    await waitFor(() => expect(screen.getByRole("option", { name: "US Warmup" })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox", { name: /move to group/i }), "grp-1");
    const moveBtn = screen.getByRole("button", { name: /^move$/i });
    await waitFor(() => expect(moveBtn).toBeEnabled());
    await user.click(moveBtn);
    await waitFor(() => expect(moveBody).toEqual({ id: "grp-1", image_ids: ["cp-1", "cp-2"] }));
  });

  it("installs the chosen app to selected phones with {image_ids,app_id}", async () => {
    const user = userEvent.setup();
    useFleetStore.getState().selectAll(["cp-1", "cp-2"]);
    renderBar();
    await waitFor(() => expect(screen.getByRole("option", { name: "Google Chrome" })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox", { name: /install app/i }), "app-1");
    const installBtn = screen.getByRole("button", { name: /^install$/i });
    await waitFor(() => expect(installBtn).toBeEnabled());
    await user.click(installBtn);
    await waitFor(() => expect(installBody).toEqual({ image_ids: ["cp-1", "cp-2"], app_id: "app-1" }));
  });
});
