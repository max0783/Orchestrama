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
import type { IOllamaClient, OllamaModelInfo } from "../ollama/client.js";
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
    /** Model config fetched from /api/show — undefined if unavailable */
    modelInfo?: OllamaModelInfo;
    tasks: TaskResult[];
    status?: "ERROR";
    error?: string;
}
export interface BenchmarkReport {
    models: ModelResult[];
    generatedAt: string;
    /** Whether OLLAMA_FLASH_ATTENTION was enabled for this run */
    flashAttention: boolean;
    /** Context window overrides applied per model */
    contextOverrides?: Record<string, number>;
}
export interface BenchmarkHandlerOptions {
    /** Override context window per model: { "modelName": 8192 } */
    contextOverrides?: Record<string, number>;
    /** If true, ping each model before benchmarking to ensure it is warm */
    warmUp?: boolean;
    /** Progress callback — called before warm-up and before benchmarking each model */
    onModelStart?: (model: string, phase: "warmup" | "bench") => void;
    /** Called with the formatted ollama show summary just before tasks run */
    onModelInfo?: (model: string, summary: string) => void;
}
export declare function createBenchmarkHandler(ollamaClient: IOllamaClient, benchmarkOutputFile?: string): (args: unknown, opts?: BenchmarkHandlerOptions) => Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    report: BenchmarkReport;
}>;
//# sourceMappingURL=benchmark.d.ts.map