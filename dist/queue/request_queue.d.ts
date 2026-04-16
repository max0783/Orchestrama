/**
 * RequestQueue — wraps p-queue with bridge-specific logic:
 *   - Queue-full rejection (QueueFullError)
 *   - Per-request timeout cancellation (RequestTimeoutError)
 *   - Queue wait-time logging to stderr
 *   - getStatus() for observability
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
 */
import type { QueueStatus } from "../types.js";
export declare class QueueFullError extends Error {
    code: "queue_full";
    constructor();
}
export declare class RequestTimeoutError extends Error {
    code: "request_timeout";
    constructor(timeoutMs: number);
}
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
export declare class RequestQueue {
    private queue;
    private maxSize;
    constructor(concurrency: number, maxSize: number);
    /**
     * Enqueue a task.
     *
     * @param fn        Async factory that produces the work to run.
     * @param timeoutMs Per-request timeout in milliseconds.
     * @returns         The resolved value of `fn()`.
     * @throws          QueueFullError  — when the waiting queue is at capacity.
     * @throws          RequestTimeoutError — when `fn()` takes longer than `timeoutMs`.
     */
    enqueue<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T>;
    /**
     * Returns the current queue status snapshot (Req 18.7).
     *
     * Note: `queue.size` is waiting tasks; `queue.pending` is running tasks.
     */
    getStatus(): QueueStatus;
}
//# sourceMappingURL=request_queue.d.ts.map