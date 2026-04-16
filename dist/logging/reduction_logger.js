import fs from "fs/promises";
/**
 * Logs every `query_local_model` invocation to a JSONL file for auditing and
 * tuning. Writes are fire-and-forget (scheduled via `setImmediate`) so they
 * never delay the response to the orchestrator (Req 12.4).
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 */
export class ReductionLogger {
    logPath;
    constructor(logPath) {
        this.logPath = logPath;
    }
    /**
     * Appends a reduction record to the JSONL log file.
     * Fire-and-forget: the write is scheduled via `setImmediate` and any write
     * failure is silently swallowed so the caller is never blocked (Req 12.4).
     */
    append(record) {
        setImmediate(() => {
            const line = JSON.stringify(record) + "\n";
            fs.appendFile(this.logPath, line).catch(() => {
                // Silently swallow log write failures (Req 12.4)
            });
        });
    }
    /**
     * Reads the JSONL log file and computes aggregate statistics.
     * Returns empty stats if the file does not exist yet (Req 12.5, 12.6, 12.7).
     */
    async readStats() {
        let content;
        try {
            content = await fs.readFile(this.logPath, "utf-8");
        }
        catch {
            // File doesn't exist yet — return empty stats
            return {
                totalInvocations: 0,
                averageReductionRatio: 0,
                totalTokensSaved: 0,
                byModel: {},
                byTaskType: {},
            };
        }
        const records = content
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line) => JSON.parse(line));
        const totalInvocations = records.length;
        if (totalInvocations === 0) {
            return {
                totalInvocations: 0,
                averageReductionRatio: 0,
                totalTokensSaved: 0,
                byModel: {},
                byTaskType: {},
            };
        }
        const totalReductionRatio = records.reduce((sum, r) => sum + r.reductionRatio, 0);
        const averageReductionRatio = totalReductionRatio / totalInvocations;
        const totalTokensSaved = records.reduce((sum, r) => sum + (r.inputTokens - r.outputTokens), 0);
        // Breakdown by model — accumulate sum of ratios first, then average
        const byModel = {};
        // Breakdown by task type
        const byTaskType = {};
        for (const record of records) {
            // byModel
            if (!byModel[record.model]) {
                byModel[record.model] = { invocations: 0, averageReductionRatio: 0 };
            }
            byModel[record.model].invocations++;
            byModel[record.model].averageReductionRatio += record.reductionRatio;
            // byTaskType
            if (!byTaskType[record.taskType]) {
                byTaskType[record.taskType] = { invocations: 0, averageReductionRatio: 0 };
            }
            byTaskType[record.taskType].invocations++;
            byTaskType[record.taskType].averageReductionRatio += record.reductionRatio;
        }
        // Convert accumulated sums to averages
        for (const key of Object.keys(byModel)) {
            byModel[key].averageReductionRatio /= byModel[key].invocations;
        }
        for (const key of Object.keys(byTaskType)) {
            byTaskType[key].averageReductionRatio /= byTaskType[key].invocations;
        }
        return {
            totalInvocations,
            averageReductionRatio,
            totalTokensSaved,
            byModel,
            byTaskType,
        };
    }
}
//# sourceMappingURL=reduction_logger.js.map