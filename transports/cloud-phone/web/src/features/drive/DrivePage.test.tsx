import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "../../test/mswHandlers";
import { DrivePage } from "./DrivePage";
import React from "react";

let pushBody: { ids: string[]; image_ids: string[]; dest_dir: string } | null = null;
const pushSpy = http.post("/api/drive/push", async ({ request }) => {
  pushBody = (await request.json()) as { ids: string[]; image_ids: string[]; dest_dir: string };
  return HttpResponse.json({ message: "Success", success: [], fail: [] });
});

let uploadReceived = false;
const uploadSpy = http.post("/api/drive/upload", async () => {
  uploadReceived = true;
  return HttpResponse.json({ name: "f.png", original_file_name: "my-photo.png" });
});

const server = setupServer(uploadSpy, pushSpy, ...handlers);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); pushBody = null; uploadReceived = false; });
afterAll(() => server.close());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DrivePage /></QueryClientProvider>);
}

describe("DrivePage", () => {
  it("renders files from the API", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("promo.mp4")).toBeInTheDocument());
    expect(screen.getByText("summer-promo-final.mp4")).toBeInTheDocument();
  });

  it("pushes files with {ids,image_ids,dest_dir} and default dest", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("promo.mp4");
    await user.type(screen.getByLabelText(/push file ids/i), "file-1");
    await user.type(screen.getByLabelText(/push phone ids/i), "cp-1, cp-2");
    await user.click(screen.getByRole("button", { name: /push files/i }));
    await waitFor(() => expect(pushBody).toEqual({ ids: ["file-1"], image_ids: ["cp-1", "cp-2"], dest_dir: "/sdcard/Download" }));
  });

  it("mints an upload URL and shows the follow-up note", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("promo.mp4");
    await user.type(screen.getByLabelText(/upload name/i), "clip.mp4");
    await user.click(screen.getByRole("button", { name: /get upload url/i }));
    await waitFor(() => expect(screen.getByText("https://oss.example/put")).toBeInTheDocument());
    expect(screen.getByText(/follow-up/i)).toBeInTheDocument();
  });

  it("uploads a selected file and shows a confirmation", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("promo.mp4");
    const file = new File(["hello"], "my-photo.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload file bytes/i), file);
    await user.click(screen.getByRole("button", { name: /^upload$/i }));
    await waitFor(() => expect(uploadReceived).toBe(true));
    expect(await screen.findByText(/Uploaded my-photo\.png/i)).toBeInTheDocument();
  });
});
