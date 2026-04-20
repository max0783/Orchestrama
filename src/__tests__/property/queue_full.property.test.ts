// Feature: ollama-mcp-bridge, Property 21: Queue-full rejection
// For any invocation that arrives when the queue already contains
// BRIDGE_QUEUE_MAX_SIZE pending requests, the bridge should immediately return
// an MCP error with code `queue_full` without enqueuing the request.
//
// **Validates: Requirements 18.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { RequestQueue, QueueFullError } from "../../queue/request_queue.js";

// ---------------------------------------------------------------------------
// Property 21: Queue-full rejection
// ---------------------------------------------------------------------------

describe("Property 21: Queue-full rejection", () => {
  it(
    "throws QueueFullError when the waiting queue is at maxSize capacity",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // maxSize between 1 and 5 — small enough to fill quickly
          fc.integer({ min: 1, max: 5 }),
          async (maxSize) => {
            // concurrency=1 so the first task runs immediately and all
            // subsequent tasks wait.  We fill the waiting queue with
            // `maxSize` slow tasks, then verify the next enqueue rejects.
            const queue = new RequestQueue(1, maxSize);

            // Use a shared signal to resolve all slow tasks at once.
            let releaseAll!: () => void;
            const gate = new Promise<void>((resolve) => {
              releaseAll = resolve;
            });

            const slowTask = () => gate;

            // Enqueue maxSize + 1 tasks:
            //   - 1 running  (occupies the concurrency slot, not in queue.size)
            //   - maxSize waiting (fills queue.size to maxSize)
            const fillerPromises: Promise<void>[] = [];
            for (let i = 0; i < maxSize + 1; i++) {
              fillerPromises.push(queue.enqueue(slowTask, 60_000));
            }

            // At this point queue.size === maxSize (waiting) and
            // queue.pending === 1 (running).  The next enqueue must reject
            // with QueueFullError.
            //
            // Note: enqueue() is async, so even a throw before the first
            // await becomes a rejected Promise.  We must await it.
            let thrownError: unknown;
            try {
              await queue.enqueue(slowTask, 60_000);
            } catch (err) {
              thrownError = err;
            }

            // Release all blocked tasks so the queue drains cleanly.
            releaseAll();
            await Promise.allSettled(fillerPromises);

            expect(thrownError).toBeInstanceOf(QueueFullError);
            expect((thrownError as QueueFullError).code).toBe("queue_full");
          }
        ),
        { numRuns: 100 }
      );
    },
    // Allow enough time for 100 runs.
    60_000
  );
});
