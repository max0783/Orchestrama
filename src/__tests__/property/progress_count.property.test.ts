// Feature: orchestrama, Property 16: Progress notification count during Map-Reduce
// For any payload requiring N chunks in the Map phase, exactly N chunk-progress
// notifications should be emitted during that Map phase (one per chunk completion).
//
// **Validates: Requirements 15.2, 15.3**

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { Chunker, estimateTokens, splitIntoChunks } from "../../chunking/index.js";
import { ProgressNotifier } from "../../notifications/progress.js";
import type { GenerateRequest, GenerateResponse } from "../../types.js";

function makeResponse(response: string): GenerateResponse {
  return {
    model: "llama3",
    response,
    context: [],
    done: true,
  };
}

describe("Property 16: Progress notification count during Map-Reduce", () => {
  it(
    "emits exactly N chunk_done notifications for a payload requiring N chunks",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // contextWindow: small enough to force chunking
          fc.integer({ min: 40, max: 300 }),
          // payload: large enough to require multiple chunks
          fc.string({ minLength: 600, maxLength: 4000 }),
          async (contextWindow, payload) => {
            const systemPrompt = "Summarize concisely.";
            const systemPromptTokens = estimateTokens(systemPrompt);

            // Determine how many chunks the Map phase will produce
            const maxChunkTokens =
              Math.floor(contextWindow * 0.9) - systemPromptTokens;

            // Only run the property when the payload actually requires chunking
            const totalTokens = estimateTokens(payload + systemPrompt);
            if (totalTokens <= contextWindow * 0.9) {
              // Payload fits in one call — no Map phase, skip this sample
              return true;
            }

            if (maxChunkTokens <= 0) {
              // Degenerate config — skip
              return true;
            }

            const expectedChunks = splitIntoChunks(payload, maxChunkTokens).length;

            // Track notifications via a mock sendNotification
            const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
            const sender = vi.fn((n: { method: string; params: Record<string, unknown> }) => {
              notifications.push(n);
            });

            const notifier = new ProgressNotifier(sender);

            // Wire the notifier into the Chunker's onProgress callback
            const mockGenerate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResponse> => {
              return makeResponse("chunk summary");
            });

            const chunker = new Chunker(mockGenerate);

            await chunker.process(
              payload,
              systemPrompt,
              {
                contextWindow,
                systemPromptTokens,
                model: "llama3",
              },
              (event) => {
                if (event.type === "chunk_done") {
                  notifier.chunkDone(event.index, event.total, event.elapsedMs);
                } else if (event.type === "started") {
                  notifier.started(event.estimatedChunks);
                } else if (event.type === "reducing") {
                  notifier.reducing(event.summaryCount);
                }
              }
            );

            // Count only the chunk_done notifications from the first Map phase.
            // The Reduce phase may recurse and emit more chunk_done events if the
            // combined summaries still exceed the context window, so we count only
            // the first batch (up to expectedChunks).
            const chunkDoneNotifications = notifications.filter(
              (n) =>
                n.method === "notifications/progress" &&
                n.params.status === "chunk_done"
            );

            // The first N chunk_done notifications correspond to the first Map phase.
            // Verify that at least expectedChunks notifications were emitted and that
            // the first batch matches exactly.
            expect(chunkDoneNotifications.length).toBeGreaterThanOrEqual(expectedChunks);

            // Verify the first Map phase emitted exactly expectedChunks notifications
            // by checking the index sequence: 1, 2, ..., N
            for (let i = 0; i < expectedChunks; i++) {
              expect(chunkDoneNotifications[i].params.index).toBe(i + 1);
              expect(chunkDoneNotifications[i].params.total).toBe(expectedChunks);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "emits zero chunk_done notifications when disabled (BRIDGE_DISABLE_PROGRESS=true)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 40, max: 200 }),
          fc.string({ minLength: 600, maxLength: 3000 }),
          async (contextWindow, payload) => {
            const systemPrompt = "Summarize.";
            const totalTokens = estimateTokens(payload + systemPrompt);
            if (totalTokens <= contextWindow * 0.9) {
              return true; // skip non-chunked cases
            }

            const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
            const sender = vi.fn((n: { method: string; params: Record<string, unknown> }) => {
              notifications.push(n);
            });

            // disabled = true → all methods are no-ops
            const notifier = new ProgressNotifier(sender, true);

            const mockGenerate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResponse> => {
              return makeResponse("summary");
            });

            const chunker = new Chunker(mockGenerate);

            await chunker.process(
              payload,
              systemPrompt,
              {
                contextWindow,
                systemPromptTokens: estimateTokens(systemPrompt),
                model: "llama3",
              },
              (event) => {
                if (event.type === "chunk_done") {
                  notifier.chunkDone(event.index, event.total, event.elapsedMs);
                } else if (event.type === "started") {
                  notifier.started(event.estimatedChunks);
                } else if (event.type === "reducing") {
                  notifier.reducing(event.summaryCount);
                }
              }
            );

            // No notifications should have been sent when disabled
            expect(notifications).toHaveLength(0);
            expect(sender).not.toHaveBeenCalled();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
