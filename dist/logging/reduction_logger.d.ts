import type { ReductionRecord } from "../types.js";
/**
 * Aggregate statistics computed from all reduction log records.
 */
export interface ReductionStats {
    totalInvocations: number;
    averageReductionRatio: number;
    totalTokensSaved: number;
    byModel: Record<string, {
        invocations: number;
        averageReductionRatio: number;
    }>;
    byTaskType: Record<string, {
        invocations: number;
        averageReductionRatio: number;
    }>;
}
/** Interface for the reduction logger — use this in dependency injection so tests can pass plain objects. */
export interface IReductionLogger {
    append(record: ReductionRecord): void;
    readStats(): Promise<ReductionStats>;
}
/**
 * Logs every `query_local_model` invocation to a JSONL file for auditing and
 * tuning. Writes are fire-and-forget (scheduled via `setImmediate`) so they
 * never delay the response to the orchestrator (Req 12.4).
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 */
export declare class ReductionLogger {
    private logPath;
    constructor(logPath: string);
    /**
     * Appends a reduction record to the JSONL log file.
     * Fire-and-forget: the write is scheduled via `setImmediate` and any write
     * failure is silently swallowed so the caller is never blocked (Req 12.4).
     */
    append(record: ReductionRecord): void;
    /**
     * Reads the JSONL log file and computes aggregate statistics.
     * Returns empty stats if the file does not exist yet (Req 12.5, 12.6, 12.7).
     */
    readStats(): Promise<ReductionStats>;
}
//# sourceMappingURL=reduction_logger.d.ts.map