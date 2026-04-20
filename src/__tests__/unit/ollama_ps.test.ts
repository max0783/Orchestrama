import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaClient, OllamaError } from "../../ollama/client.js";

// Helper to create a mock fetch response
function mockResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const BASE_URL = "http://localhost:11434";

describe("OllamaClient.listRunningModels()", () => {
  let client: OllamaClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    client = new OllamaClient(BASE_URL, "10m");
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Task 9.1 — Validates: Requirements 1.2
  it("calls GET /api/ps with the correct URL", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse(200, JSON.stringify({ models: [] }))
    );

    await client.listRunningModels();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl: string = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toMatch(/\/api\/ps$/);
  });

  // Task 9.2 — Validates: Requirements 1.5
  it("returns [] when response contains { models: [] }", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse(200, JSON.stringify({ models: [] }))
    );

    const result = await client.listRunningModels();
    expect(result).toEqual([]);
  });

  // Task 9.3 — Validates: Requirements 1.4
  it("throws OllamaError('service_unavailable') on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"));

    await expect(client.listRunningModels()).rejects.toMatchObject({
      code: "service_unavailable",
    });
    await expect(
      (async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"));
        await client.listRunningModels();
      })()
    ).rejects.toBeInstanceOf(OllamaError);
  });

  // Task 9.4 — Validates: Requirements 1.4
  it("throws OllamaError('service_unavailable') on non-OK HTTP response", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(503, "service unavailable"));

    await expect(client.listRunningModels()).rejects.toMatchObject({
      code: "service_unavailable",
    });
    await expect(
      (async () => {
        fetchSpy.mockResolvedValueOnce(mockResponse(503, "service unavailable"));
        await client.listRunningModels();
      })()
    ).rejects.toBeInstanceOf(OllamaError);
  });
});
