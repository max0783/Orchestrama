/**
 * benchmark_models tool handler.
 *
 * Runs code summarization, log analysis, and file review tasks against each
 * model. Measures latency (ms), throughput (tokens/s), and response length.
 * Supports iterations > 1 with mean and standard deviation reporting.
 * On model failure records status: "ERROR" and continues.
 * Saves JSON results to BENCHMARK_OUTPUT_FILE if configured.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10
 */
import type { IOllamaClient } from "../ollama/client.js";
export interface TaskMetrics {
    latency: number;
    throughput: number;
    responseLength: number;
}
export interface TaskMetricsWithStats extends TaskMetrics {
    latencyStdDev?: number;
    throughputStdDev?: number;
    responseLengthStdDev?: number;
}
export interface TaskResult {
    taskName: string;
    metrics: TaskMetricsWithStats;
}
export interface ModelResult {
    model: string;
    tasks: TaskResult[];
    status?: "ERROR";
    error?: string;
}
export interface BenchmarkReport {
    models: ModelResult[];
    generatedAt: string;
}
export declare function createBenchmarkHandler(ollamaClient: IOllamaClient, benchmarkOutputFile?: string): (args: unknown) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=benchmark.d.ts.map