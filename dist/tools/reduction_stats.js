/**
 * get_reduction_stats tool handler.
 *
 * Reads the reduction log via ReductionLogger.readStats() and returns
 * formatted aggregate statistics.
 *
 * Requirements: 12.5
 */
/**
 * Factory function that accepts dependencies and returns a handler function.
 */
export function createReductionStatsHandler(reductionLogger) {
    return async (_args) => {
        const stats = await reductionLogger.readStats();
        const text = [
            `Total invocations: ${stats.totalInvocations}`,
            `Average reduction ratio: ${stats.averageReductionRatio.toFixed(3)}`,
            `Total tokens saved: ${stats.totalTokensSaved}`,
            `\nBy model:`,
            ...Object.entries(stats.byModel).map(([m, s]) => `  ${m}: ${s.invocations} invocations, avg ratio ${s.averageReductionRatio.toFixed(3)}`),
            `\nBy task type:`,
            ...Object.entries(stats.byTaskType).map(([t, s]) => `  ${t}: ${s.invocations} invocations, avg ratio ${s.averageReductionRatio.toFixed(3)}`),
        ].join("\n");
        return { content: [{ type: "text", text }] };
    };
}
//# sourceMappingURL=reduction_stats.js.map