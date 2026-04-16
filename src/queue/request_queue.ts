/**
 * RequestQueue — wraps p-queue with bridge-specific logic:
 *   - Queue-full rejection (QueueFullError)
 *   - Per-request timeout cancellation (RequestTimeoutError)
 *   - Queue wait-time logging to stderr
 *   - getStatus() for observability
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
 */

import PQueue from "p-queue";
import type { QueueStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class QueueFullError extends Error {
  code = "queue_full" as const;
  constructor() {
    super("Request queue is full");
    this.name = "QueueFullError";
  }
}

export class RequestTimeoutError extends Error {
  code = "request_timeout" as const;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// RequestQueue
// ---------------------------------------------------------------------------

/**
 * FIFO request queue backed by p-queue.
 *
 * In p-queue v8:
 *   - `queue.size`    = number of PENDING (waiting) tasks
 *   - `queue.pending` = number of RUNNING tasks
 *
 * `maxSize` is the maximum number of *waiting* tasks allowed.  When
 * `queue.size >= maxSize` a new enqueue attempt throws QueueFullError
 * immediately without adding the task to the queue.
 *
 * Concurrency is set to `OLLAMA_NUM_PARALLEL` (passed in as `concurrency`).
 */
export class RequestQueue {
  private queue: PQueue;
  private maxSize: number;

  constructor(concurrency: number, maxSize: number) {
    this.queue = new PQueue({ concurrency });
    this.maxSize = maxSize;
  }

  /**
   * Enqueue a task.
   *
   * @param fn        Async factory that produces the work to run.
   * @param timeoutMs Per-request timeout in milliseconds.
   * @returns         The resolved value of `fn()`.
   * @throws          QueueFullError  — when the waiting queue is at capacity.
   * @throws          RequestTimeoutError — when `fn()` takes longer than `timeoutMs`.
   */
  async enqueue<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    // Reject immediately if the waiting queue is full (Req 18.4)
    if (this.queue.size >= this.maxSize) {
      throw new QueueFullError();
    }

    const enqueueTime = Date.now();

    // p-queue.add() returns Promise<T | void> when the task type is inferred
    // as returning T | void.  We cast to Promise<T> because our task always
    // resolves to T (or rejects).
    return this.queue.add(async () => {
      // Log queue wait time to stderr on dequeue (Req 18.6)
      const waitTime = Date.now() - enqueueTime;
      process.stderr.write(
        `[ollama-mcp-bridge] Queue wait time: ${waitTime}ms\n`
      );

      // Per-request timeout (Req 18.3)
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new RequestTimeoutError(timeoutMs));
        }, timeoutMs);

        fn().then(
          (result) => {
            clearTimeout(timer);
            resolve(result);
          },
          (err: unknown) => {
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    }) as Promise<T>;
  }

  /**
   * Returns the current queue status snapshot (Req 18.7).
   *
   * Note: `queue.size` is waiting tasks; `queue.pending` is running tasks.
   */
  getStatus(): QueueStatus {
    return {
      queueLength: this.queue.size,
      activeRequests: this.queue.pending,
      concurrencyLimit: this.queue.concurrency,
    };
  }
}
