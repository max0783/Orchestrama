// Feature: orchestrama, Property 14: Keep-alive field presence
// For any request sent to the Ollama /api/generate endpoint, the request body
// should contain a `keep_alive` field equal to the configured OLLAMA_KEEP_ALIVE value.
//
// **Validates: Requirements 13.1, 13.2, 13.3**

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import { OllamaClient } from "../../ollama/client.js";
import type { GenerateResponse } from "../../types.js";

function makeSuccessResponse(model: string): GenerateResponse {
  return {
    model,
    response: "ok",
    context: [],
    done: true,
  };
}

describe("Property 14: Keep-alive field presence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every generate() call includes keep_alive equal to the configured value", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary keep_alive config values
        fc.oneof(
          fc.constant("5m"),
          fc.constant("10m"),
          fc.constant("30m"),
          fc.constant("1h"),
          fc.constant("0"),
          fc.constant("-1"),
          fc.stringMatching(/^\d+[smh]$/)
        ),
        // Arbitrary model names
        fc.string({ minLength: 1, maxLength: 50 }),
        // Arbitrary prompts
        fc.string({ maxLength: 200 }),
        async (keepAlive, model, prompt) => {
          const capturedBodies: string[] = [];

          const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
            async (_url, init) => {
              capturedBodies.push(init?.body as string);
              return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(makeSuccessResponse(model)),
                json: async () => makeSuccessResponse(model),
              } as unknown as Response;
            }
          );

          try {
            const client = new OllamaClient("http://localhost:11434", keepAlive);
            await client.generate({ model, prompt });
            expect(capturedBodies.length).toBe(1);
            const body = JSON.parse(capturedBodies[0]);
            expect(body.keep_alive).toBe(keepAlive);
          } finally {
            fetchSpy.mockRestore();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("keep_alive in request body matches config even when request specifies a different keep_alive", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant("5m"),
          fc.constant("10m"),
          fc.constant("1h"),
          fc.stringMatching(/^\d+[smh]$/)
        ),
        fc.oneof(
          fc.constant("1m"),
          fc.constant("2h"),
          fc.stringMatching(/^\d+[smh]$/)
        ),
        async (configuredKeepAlive, requestKeepAlive) => {
          const capturedBodies: string[] = [];

          const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
            async (_url, init) => {
              capturedBodies.push(init?.body as string);
              return {
                ok: true,
                status: 200,
                text: async () =>
                  JSON.stringify(makeSuccessResponse("llama3")),
                json: async () => makeSuccessResponse("llama3"),
              } as unknown as Response;
            }
          );

          try {
            const client = new OllamaClient("http://localhost:11434", configuredKeepAlive);
            await client.generate({ model: "llama3", prompt: "test", keep_alive: requestKeepAlive });
            const body = JSON.parse(capturedBodies[0]);
            // The configured keep_alive always wins
            expect(body.keep_alive).toBe(configuredKeepAlive);
          } finally {
            fetchSpy.mockRestore();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
