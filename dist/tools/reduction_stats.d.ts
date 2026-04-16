/**
 * get_reduction_stats tool handler.
 *
 * Reads the reduction log via ReductionLogger.readStats() and returns
 * formatted aggregate statistics.
 *
 * Requirements: 12.5
 */
import type { IReductionLogger } from "../logging/reduction_logger.js";
/**
 * Factory function that accepts dependencies and returns a handler function.
 */
export declare function createReductionStatsHandler(reductionLogger: IReductionLogger): (_args: unknown) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=reduction_stats.d.ts.map