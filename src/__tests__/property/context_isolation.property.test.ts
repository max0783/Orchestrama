// Feature: orchestrama, Property 3: Map-phase context isolation
// For any payload that requires N > 1 chunks, each of the N Ollama calls in the
// Map phase should be sent with context: null (not the context token array returned
// by a previous chunk call).
//
// **Validates: Requirements 2.7, 4.4**

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { Chunker } from "../../chunking/index.js";
import type { GenerateRequest, GenerateResponse } from "../../types.js";

function makeResponse(response: string): GenerateResponse {
  return {
    model: "llama3",
    response,
    context: [1, 2, 3, 4, 5], // non-null context returned by Ollama
    done: true,
  };
}

describe("Property 3: Map-phase context isolation", () => {
  it("every Map-phase Ollama call is sent with context: null", async () => {
    await fc.assert(
      fc.asyncProperty(
        // contextWindow small enough to force chunking
        fc.integer({ min: 40, max: 200 }),
        // payload large enough to require multiple chunks
        fc.string({ minLength: 500, maxLength: 3000 }),
        async (contextWindow, payload) => {
          const capturedRequests: GenerateRequest[] = [];

          const mockGenerate = vi.fn(async (req: GenerateRequest): Promise<GenerateResponse> => {
            capturedRequests.push({ ...req });
            return makeResponse("summary of chunk");
          });

          const chunker = new Chunker(mockGenerate);
          const systemPrompt = "Summarize concisely.";

          await chunker.process(
            payload,
            systemPrompt,
            {
              contextWindow,
              systemPromptTokens: 5,
              model: "llama3",
            },
            () => {} // no-op progress callback
          );

          // Find the Map-phase calls: these are the calls made before the reduce
          // phase. In the Map phase, context must always be null.
          // All calls should have context: null (both Map and single-call paths).
          for (const req of capturedRequests) {
            expect(req.context).toBeNull();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("context returned by one chunk is not passed to the next chunk in Map phase", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Force chunking: small context window, large payload
        fc.integer({ min: 20, max: 100 }),
        fc.array(
          fc.string({ minLength: 50, maxLength: 200 }),
          { minLength: 3, maxLength: 10 }
        ),
        async (contextWindow, words) => {
          const payload = words.join(" ");
          const capturedContexts: (number[] | null | undefined)[] = [];

          const mockGenerate = vi.fn(async (req: GenerateRequest): Promise<GenerateResponse> => {
            capturedContexts.push(req.context);
            return makeResponse("chunk summary");
          });

          const chunker = new Chunker(mockGenerate);

          await chunker.process(
            payload,
            "",
            {
              contextWindow,
              systemPromptTokens: 0,
              model: "llama3",
            },
            () => {}
          );

          // Every captured context must be null — never a token array from a prior call
          for (const ctx of capturedContexts) {
            expect(ctx).toBeNull();
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
