// Feature: ollama-mcp-bridge, Property 9: Chunking termination and completeness
// For any payload of arbitrary size, the Map-Reduce processor should always terminate
// and return a non-empty response (no infinite recursion), and the final response
// should be derived from all chunks.
//
// **Validates: Requirements 4.5, 4.8**

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { Chunker } from "../../chunking/index.js";
import type { GenerateRequest, GenerateResponse } from "../../types.js";

describe("Property 9: Chunking termination and completeness", () => {
  it("process() always terminates and returns a non-empty response", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary context window
        fc.integer({ min: 20, max: 500 }),
        // Arbitrary payload size
        fc.string({ minLength: 0, maxLength: 10000 }),
        async (contextWindow, payload) => {
          // Mock returns a short fixed response to ensure convergence
          const mockGenerate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResponse> => {
            return {
              model: "llama3",
              response: "ok",
              context: [],
              done: true,
            };
          });

          const chunker = new Chunker(mockGenerate);

          const result = await chunker.process(
            payload,
            "Summarize.",
            {
              contextWindow,
              systemPromptTokens: 2,
              model: "llama3",
            },
            () => {}
          );

          // Must always return a result
          expect(result).toBeDefined();
          expect(typeof result.finalResponse).toBe("string");
          expect(result.finalResponse.length).toBeGreaterThan(0);
          expect(typeof result.chunksUsed).toBe("number");
          expect(typeof result.wasChunked).toBe("boolean");

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("recursion guard triggers at depth 10 and returns a non-empty warning response", async () => {
    // Construct a scenario where the mock always returns a large response,
    // forcing infinite recursion — the guard must kick in.
    const contextWindow = 50;
    // Mock always returns a response that is larger than the context window
    const largeResponse = "x".repeat(contextWindow * 10);

    const mockGenerate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResponse> => {
      return {
        model: "llama3",
        response: largeResponse,
        context: [],
        done: true,
      };
    });

    const chunker = new Chunker(mockGenerate);

    const result = await chunker.process(
      largeResponse,
      "",
      {
        contextWindow,
        systemPromptTokens: 0,
        model: "llama3",
      },
      () => {}
    );

    expect(result.finalResponse).toContain("[WARNING: max recursion depth reached");
    expect(result.wasChunked).toBe(true);
  });

  it("process() with empty payload returns a response", async () => {
    const mockGenerate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResponse> => {
      return {
        model: "llama3",
        response: "empty response",
        context: [],
        done: true,
      };
    });

    const chunker = new Chunker(mockGenerate);

    const result = await chunker.process(
      "",
      "Summarize.",
      {
        contextWindow: 100,
        systemPromptTokens: 2,
        model: "llama3",
      },
      () => {}
    );

    expect(result.finalResponse.length).toBeGreaterThan(0);
  });
});
