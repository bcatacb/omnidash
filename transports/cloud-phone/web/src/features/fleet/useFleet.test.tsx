import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../test/mswHandlers";
import { usePhones } from "./useFleet";
import React from "react";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("usePhones", () => {
  it("loads phones", async () => {
    const { result } = renderHook(() => usePhones({ page: 1, pageSize: 20 }), { wrapper });
    await waitFor(() => expect(result.current.data?.total).toBe(1));
    expect(result.current.data?.items[0].name).toBe("P1");
  });
});
