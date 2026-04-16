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

import fs from "fs/promises";
import type { IOllamaClient } from "../ollama/client.js";
import type { GenerateResponse } from "../types.js";

// ---------------------------------------------------------------------------
// Benchmark task definitions
// ---------------------------------------------------------------------------

const BENCHMARK_TASKS = [
  {
    name: "code_summarization",
    prompt: "Summarize this function: function add(a, b) { return a + b; }",
  },
  {
    name: "log_analysis",
    prompt:
      "Analyze these logs: ERROR 2024-01-01 Connection refused\nWARN 2024-01-01 Retry attempt 1",
  },
  {
    name: "file_review",
    prompt: "Review this code: const x = eval(userInput);",
  },
] as const;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface TaskMetrics {
  latency: number;       // ms
  throughput: number;    // tokens/s
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

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Single task runner
// ---------------------------------------------------------------------------

async function runTask(
  ollamaClient: IOllamaClient,
  model: string,
  prompt: string,
  iterations: number
): Promise<TaskMetricsWithStats | { status: "ERROR"; error: string }> {
  const latencies: number[] = [];
  const throughputs: number[] = [];
  const responseLengths: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    let response: GenerateResponse;

    try {
      response = await ollamaClient.generate({
        model,
        prompt,
        stream: false,
      });
    } catch (err) {
      return {
        status: "ERROR",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const latency = Date.now() - start;

    // Compute throughput: eval_count / (total_duration / 1e9) tokens/s
    // Fall back to response.length / (latency / 1000) if Ollama fields absent
    let throughput = 0;
    if (
      response.eval_count !== undefined &&
      response.total_duration !== undefined &&
      response.total_duration > 0
    ) {
      throughput = response.eval_count / (response.total_duration / 1e9);
    } else if (latency > 0) {
      throughput = response.response.length / (latency / 1000);
    }

    latencies.push(latency);
    throughputs.push(throughput);
    responseLengths.push(response.response.length);
  }

  const result: TaskMetricsWithStats = {
    latency: mean(latencies),
    throughput: mean(throughputs),
    responseLength: mean(responseLengths),
  };

  if (iterations > 1) {
    result.latencyStdDev = stdDev(latencies);
    result.throughputStdDev = stdDev(throughputs);
    result.responseLengthStdDev = stdDev(responseLengths);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Report formatter
// ---------------------------------------------------------------------------

function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [
    `Benchmark Report — ${report.generatedAt}`,
    "=".repeat(60),
  ];

  for (const modelResult of report.models) {
    lines.push(`\nModel: ${modelResult.model}`);

    if (modelResult.status === "ERROR") {
      lines.push(`  Status: ERROR — ${modelResult.error ?? "unknown error"}`);
      continue;
    }

    for (const taskResult of modelResult.tasks) {
      const m = taskResult.metrics;
      lines.push(`  Task: ${taskResult.taskName}`);
      lines.push(`    Latency:        ${m.latency.toFixed(1)} ms${m.latencyStdDev !== undefined ? ` (±${m.latencyStdDev.toFixed(1)})` : ""}`);
      lines.push(`    Throughput:     ${m.throughput.toFixed(2)} tokens/s${m.throughputStdDev !== undefined ? ` (±${m.throughputStdDev.toFixed(2)})` : ""}`);
      lines.push(`    Response len:   ${m.responseLength.toFixed(0)} chars${m.responseLengthStdDev !== undefined ? ` (±${m.responseLengthStdDev.toFixed(0)})` : ""}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createBenchmarkHandler(
  ollamaClient: IOllamaClient,
  benchmarkOutputFile?: string
) {
  return async (args: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;

    // Resolve model list: use provided list or fall back to all available models
    let models: string[];
    if (Array.isArray(a["models"]) && a["models"].length > 0) {
      models = a["models"] as string[];
    } else {
      models = await ollamaClient.listModels();
    }

    const iterations =
      typeof a["iterations"] === "number" && a["iterations"] >= 1
        ? Math.floor(a["iterations"])
        : 1;

    const modelResults: ModelResult[] = [];

    for (const model of models) {
      const taskResults: TaskResult[] = [];
      let modelFailed = false;
      let modelError = "";

      for (const task of BENCHMARK_TASKS) {
        const result = await runTask(ollamaClient, model, task.prompt, iterations);

        if ("status" in result && result.status === "ERROR") {
          // Record error and stop further tasks for this model (Req 8.10)
          modelFailed = true;
          modelError = result.error;
          break;
        }

        taskResults.push({
          taskName: task.name,
          metrics: result as TaskMetricsWithStats,
        });
      }

      if (modelFailed) {
        modelResults.push({
          model,
          tasks: [],
          status: "ERROR",
          error: modelError,
        });
      } else {
        modelResults.push({
          model,
          tasks: taskResults,
        });
      }
    }

    const report: BenchmarkReport = {
      models: modelResults,
      generatedAt: new Date().toISOString(),
    };

    // Save JSON results to BENCHMARK_OUTPUT_FILE if configured (Req 8.9)
    if (benchmarkOutputFile) {
      try {
        await fs.writeFile(benchmarkOutputFile, JSON.stringify(report, null, 2), "utf-8");
      } catch (err) {
        process.stderr.write(
          `[ollama-mcp-bridge] Failed to write benchmark output to ${benchmarkOutputFile}: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }

    const text = formatReport(report);
    return { content: [{ type: "text" as const, text }] };
  };
}
