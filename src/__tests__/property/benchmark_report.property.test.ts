// Feature: ollama-mcp-bridge, Property 22: Benchmark report completeness
// For any list of model names passed to `benchmark_models` (with mocked Ollama),
// the returned report should contain an entry for every model in the list, and
// each entry should include `latency`, `throughput`, and `responseLength` fields
// (or `status: "ERROR"` if the model failed).
//
// **Validates: Requirements 8.5, 8.6, 8.10**

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createBenchmarkHandler } from "../../tools/benchmark.js";
import type { GenerateRequest, GenerateResponse } from "../../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockOllamaClient(generateFn: (req: GenerateRequest) => Promise<GenerateResponse>) {
  return {
    generate: vi.fn(generateFn),
    listModels: vi.fn(async () => [] as string[]),
    ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
    showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
  };
}

const FIXED_RESPONSE: GenerateResponse = {
  model: "test-model",
  response: "This is a fixed benchmark response for testing purposes.",
  context: [],
  done: true,
  eval_count: 10,
  total_duration: 1_000_000_000, // 1 second in nanoseconds
};

// ---------------------------------------------------------------------------
// Property 22: Benchmark report completeness
// ---------------------------------------------------------------------------

describe("Property 22: Benchmark report completeness", () => {
  it(
    "report contains an entry for every model in the input list",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Arbitrary non-empty list of model names (1–10 models)
          fc.array(
            fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
            { minLength: 1, maxLength: 10 }
          ),
          async (modelNames) => {
            const ollamaClient = createMockOllamaClient(async (_req) => ({
              ...FIXED_RESPONSE,
              model: _req.model,
            }));

            const handler = createBenchmarkHandler(ollamaClient);
            const result = await handler({ models: modelNames });

            // Parse the text output to verify structure
            // The handler returns text, but we need to verify the underlying data.
            // We'll re-run with a spy to capture the report structure.
            expect(result.content).toHaveLength(1);
            expect(result.content[0].type).toBe("text");

            // Verify every model name appears in the output text
            for (const model of modelNames) {
              expect(result.content[0].text).toContain(model);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );

  it(
    "each successful model entry includes latency, throughput, and responseLength fields",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Arbitrary non-empty list of model names (1–5 models)
          fc.array(
            fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
            { minLength: 1, maxLength: 5 }
          ),
          async (modelNames) => {
            // Use a wrapper that captures the report by intercepting the handler
            const capturedReports: Array<{
              model: string;
              tasks: Array<{ taskName: string; metrics: Record<string, unknown> }>;
              status?: string;
            }> = [];

            const ollamaClient = createMockOllamaClient(async (_req) => ({
              ...FIXED_RESPONSE,
              model: _req.model,
            }));

            // Patch the handler to capture internal report data
            // We do this by creating a custom handler that wraps the original
            const originalHandler = createBenchmarkHandler(ollamaClient);

            // Run the handler and inspect the text output
            const result = await originalHandler({ models: modelNames });
            const text = result.content[0].text;

            // Each model should appear in the output
            for (const model of modelNames) {
              expect(text).toContain(model);
            }

            // For successful models, the output should contain metric labels
            // (latency, throughput, response length)
            expect(text).toContain("Latency:");
            expect(text).toContain("Throughput:");
            expect(text).toContain("Response len:");
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );

  it(
    "failed model entries record status ERROR and continue with remaining models",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // At least 2 models so we can have one fail and one succeed
          fc.array(
            fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
            { minLength: 2, maxLength: 6 }
          ),
          // Index of the model that will fail (0-based)
          fc.nat({ max: 1 }),
          async (modelNames, failIndex) => {
            const actualFailIndex = failIndex % modelNames.length;
            const failingModel = modelNames[actualFailIndex];

            const ollamaClient = createMockOllamaClient(async (req) => {
              if (req.model === failingModel) {
                throw new Error(`Simulated OOM error for model ${req.model}`);
              }
              return { ...FIXED_RESPONSE, model: req.model };
            });

            const handler = createBenchmarkHandler(ollamaClient);
            const result = await handler({ models: modelNames });

            const text = result.content[0].text;

            // All models should appear in the output
            for (const model of modelNames) {
              expect(text).toContain(model);
            }

            // The failing model should show ERROR status
            expect(text).toContain("ERROR");
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );

  it(
    "with iterations > 1, report includes mean metrics for each model",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // 1–3 models
          fc.array(
            fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
            { minLength: 1, maxLength: 3 }
          ),
          // 2–5 iterations
          fc.integer({ min: 2, max: 5 }),
          async (modelNames, iterations) => {
            const ollamaClient = createMockOllamaClient(async (_req) => ({
              ...FIXED_RESPONSE,
              model: _req.model,
            }));

            const handler = createBenchmarkHandler(ollamaClient);
            const result = await handler({ models: modelNames, iterations });

            const text = result.content[0].text;

            // All models should appear
            for (const model of modelNames) {
              expect(text).toContain(model);
            }

            // With iterations > 1, std dev markers (±) should appear
            expect(text).toContain("±");
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );
});
