// Feature: interactive-console-ui, Property 1: listRunningModels parsing round-trip
// For any valid /api/ps response body containing an array of model objects, parsing
// the response and extracting RunningModelInfo fields SHALL produce an array where
// each element's name, size, and size_vram match the corresponding source object exactly.
//
// **Validates: Requirements 1.3, 1.6**

import { describe, it, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import { OllamaClient } from "../../ollama/client.js";

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

const modelArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  size: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  size_vram: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  // Extra fields that should be ignored
  model: fc.string(),
  digest: fc.string(),
  expires_at: fc.string(),
});

const modelsArb = fc.array(modelArb, { minLength: 0, maxLength: 10 });

describe("Property 1: listRunningModels parsing round-trip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts exactly name, size, size_vram for each element and ignores extra fields", async () => {
    await fc.assert(
      fc.asyncProperty(modelsArb, async (models) => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        fetchSpy.mockResolvedValueOnce(
          mockResponse(200, JSON.stringify({ models }))
        );

        const client = new OllamaClient(BASE_URL, "10m");
        const result = await client.listRunningModels();

        // Same length as input
        if (result.length !== models.length) return false;

        for (let i = 0; i < models.length; i++) {
          const src = models[i];
          const got = result[i];

          // name, size, size_vram must match exactly
          if (got.name !== src.name) return false;
          if (got.size !== src.size) return false;
          if (got.size_vram !== src.size_vram) return false;

          // No extra fields should be present
          const keys = Object.keys(got);
          if (keys.length !== 3) return false;
          if (!keys.includes("name")) return false;
          if (!keys.includes("size")) return false;
          if (!keys.includes("size_vram")) return false;
        }

        vi.restoreAllMocks();
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
