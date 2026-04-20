// Feature: ollama-mcp-bridge, Property 20: FIFO queue ordering
// For any sequence of N concurrent requests arriving in a known order, the
// requests should be dispatched to Ollama in that same FIFO order.
//
// **Validates: Requirements 18.1**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { RequestQueue } from "../../queue/request_queue.js";

// ---------------------------------------------------------------------------
// Property 20: FIFO queue ordering
// ---------------------------------------------------------------------------

describe("Property 20: FIFO queue ordering", () => {
  it(
    "dispatches tasks in the order they were enqueued (concurrency=1)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // N tasks: between 2 and 10
          fc.integer({ min: 2, max: 10 }),
          async (n) => {
            // concurrency=1 ensures strict FIFO dispatch order.
            // maxSize is large enough to hold all waiting tasks.
            const queue = new RequestQueue(1, n + 10);

            const dispatchOrder: number[] = [];

            // Build tasks that record their index when they start executing.
            // Each task resolves immediately after recording its index.
            const tasks = Array.from({ length: n }, (_, i) => () =>
              new Promise<void>((resolve) => {
                dispatchOrder.push(i);
                resolve();
              })
            );

            // Enqueue all tasks synchronously so they all enter the waiting
            // queue before any of them can run (concurrency=1 means only the
            // first one starts immediately; the rest wait).
            const promises = tasks.map((task) =>
              queue.enqueue(task, 5000)
            );

            // Wait for all tasks to complete.
            await Promise.all(promises);

            // Dispatch order must equal enqueue order [0, 1, 2, ..., n-1].
            const expected = Array.from({ length: n }, (_, i) => i);
            expect(dispatchOrder).toEqual(expected);
          }
        ),
        { numRuns: 100 }
      );
    },
    // Give the test suite enough wall-clock time for 100 runs × up to 10 tasks.
    15_000
  );
});
