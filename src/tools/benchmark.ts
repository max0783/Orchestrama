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
import { OllamaError } from "../ollama/client.js";
import type { IOllamaClient, OllamaModelInfo } from "../ollama/client.js";
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
  /** Model config fetched from /api/show — undefined if unavailable */
  modelInfo?: OllamaModelInfo;
  tasks: TaskResult[];
  status?: "ERROR";
  error?: string;
  /** Effective num_ctx used — may differ from the override if OOM retries reduced it */
  effectiveNumCtx?: number;
}

export interface BenchmarkReport {
  models: ModelResult[];
  generatedAt: string;
  /** Whether OLLAMA_FLASH_ATTENTION was enabled for this run */
  flashAttention: boolean;
  /** Context window overrides applied per model */
  contextOverrides?: Record<string, number>;
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
  iterations: number,
  numCtx?: number
): Promise<TaskMetricsWithStats | { status: "ERROR"; error: string; oom: boolean }> {
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
        ...(numCtx !== undefined ? { options: { num_ctx: numCtx } } : {}),
      });
    } catch (err) {
      const oom =
        err instanceof OllamaError && err.code === "local_resource_exhausted";
      return {
        status: "ERROR",
        error: err instanceof Error ? err.message : String(err),
        oom,
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
  // Human-readable datetime alongside the ISO timestamp
  const dt = new Date(report.generatedAt);
  const humanDate = dt.toLocaleString("en-GB", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });

  const flashStr = report.flashAttention
    ? "ON  (env flag set — verify Ollama was restarted after enabling)"
    : "OFF  (env flag not set)";

  const lines: string[] = [
    `Benchmark Report — ${humanDate}  (${report.generatedAt})`,
    `Flash Attention: ${flashStr}`,
    "=".repeat(60),
  ];

  for (const modelResult of report.models) {
    lines.push(`\nModel: ${modelResult.model}`);

    // Print model config if available
    if (modelResult.modelInfo) {
      const { details, parsedParameters, modelInfoRaw } = modelResult.modelInfo;
      const configLines: string[] = [];

      // Architecture from model_info (e.g. "general.architecture": "llama")
      const arch = modelInfoRaw["general.architecture"] as string | undefined;
      if (arch)                       configLines.push(`architecture:  ${arch}`);
      if (details.family)             configLines.push(`family:        ${details.family}`);
      if (details.parameter_size)     configLines.push(`params:        ${details.parameter_size}`);
      if (details.quantization_level) configLines.push(`quantization:  ${details.quantization_level}`);
      if (details.format)             configLines.push(`format:        ${details.format}`);

      // Context length from model_info (architecture-prefixed key)
      const ctxKey = Object.keys(modelInfoRaw).find((k) => k.endsWith(".context_length"));
      if (ctxKey) {
        configLines.push(`context_length ${modelInfoRaw[ctxKey]}`);
      }

      // Key inference parameters from Modelfile
      const paramKeys = ["num_ctx", "temperature", "top_p", "top_k", "repeat_penalty", "seed", "num_predict"];
      for (const key of paramKeys) {
        if (key === "num_ctx") {
          // Override wins over Modelfile value; effectiveNumCtx wins over override (OOM reduction)
          const effective = modelResult.effectiveNumCtx;
          const override = report.contextOverrides?.[modelResult.model];
          if (effective !== undefined && override !== undefined && effective !== override) {
            configLines.push(`${"num_ctx".padEnd(14)} ${effective}  ← reduced from ${override} (OOM retry)`);
          } else if (override !== undefined) {
            configLines.push(`${"num_ctx".padEnd(14)} ${override}  ← override`);
          } else if (effective !== undefined) {
            configLines.push(`${"num_ctx".padEnd(14)} ${effective}  ← OOM-reduced`);
          } else if (parsedParameters["num_ctx"] !== undefined) {
            configLines.push(`${"num_ctx".padEnd(14)} ${parsedParameters["num_ctx"]}`);
          }
        } else if (parsedParameters[key] !== undefined) {
          configLines.push(`${key.padEnd(14)} ${parsedParameters[key]}`);
        }
      }
      if (configLines.length > 0) {
        lines.push("  Config:");
        for (const cl of configLines) {
          lines.push(`    ${cl}`);
        }
      }
    }

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

export interface BenchmarkHandlerOptions {
  /** Override context window per model: { "modelName": 8192 } */
  contextOverrides?: Record<string, number>;
  /** If true, ping each model before benchmarking to ensure it is warm */
  warmUp?: boolean;
  /** Progress callback — called before warm-up and before benchmarking each model */
  onModelStart?: (model: string, phase: "warmup" | "bench") => void;
  /** Called with the formatted ollama show summary just before tasks run */
  onModelInfo?: (model: string, summary: string) => void;
  /**
   * When true, automatically retry a model with halved num_ctx on OOM
   * instead of recording it as an error. Up to 3 halvings are attempted.
   */
  autoRetryOnOverflow?: boolean;
  /** Called when an OOM retry is about to happen, for progress display */
  onOomRetry?: (model: string, oldCtx: number, newCtx: number) => void;
}

export function createBenchmarkHandler(
  ollamaClient: IOllamaClient,
  benchmarkOutputFile?: string
) {
  return async (args: unknown, opts: BenchmarkHandlerOptions = {}) => {
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
      const numCtx = opts.contextOverrides?.[model];

      // Warm-up: load the model at the SAME num_ctx it will be benchmarked with.
      // Using generate directly (not ping) so we can pass options.num_ctx.
      // This prevents Ollama from loading at the default context and then
      // reloading at the override context on the first real task.
      if (opts.warmUp) {
        opts.onModelStart?.(model, "warmup");
        try {
          await ollamaClient.generate({
            model,
            prompt: "",
            stream: false,
            ...(numCtx !== undefined ? { options: { num_ctx: numCtx } } : {}),
          });
        } catch {
          // Non-fatal — the benchmark will record the error if the model is truly unavailable
        }
      }

      opts.onModelStart?.(model, "bench");

      // Fetch model config from /api/show (non-fatal if unavailable)
      let modelInfo: OllamaModelInfo | undefined;
      try {
        modelInfo = await ollamaClient.showModel(model);
        // Emit a human-readable summary of the model config before tasks run
        if (opts.onModelInfo && modelInfo) {
          const { details, parsedParameters, modelInfoRaw } = modelInfo;
          const summaryParts: string[] = [];
          const arch = modelInfoRaw["general.architecture"] as string | undefined;
          if (arch)                       summaryParts.push(`arch=${arch}`);
          if (details.parameter_size)     summaryParts.push(`params=${details.parameter_size}`);
          if (details.quantization_level) summaryParts.push(`quant=${details.quantization_level}`);
          const ctxKey = Object.keys(modelInfoRaw).find((k) => k.endsWith(".context_length"));
          if (ctxKey)                     summaryParts.push(`ctx=${modelInfoRaw[ctxKey]}`);
          // Show effective num_ctx: override wins, then Modelfile value, then model default
          const effectiveCtx = opts.contextOverrides?.[model]
            ?? (parsedParameters["num_ctx"] ? parseInt(parsedParameters["num_ctx"], 10) : undefined);
          if (effectiveCtx !== undefined)  summaryParts.push(`num_ctx=${effectiveCtx}${opts.contextOverrides?.[model] ? " (override)" : ""}`);
          if (parsedParameters["temperature"]) summaryParts.push(`temp=${parsedParameters["temperature"]}`);
          opts.onModelInfo(model, summaryParts.join("  "));
        }
      } catch {
        modelInfo = undefined;
      }

      // Run tasks with optional OOM auto-retry (halve num_ctx up to 3 times)
      const MAX_OOM_HALVINGS = 3;
      let effectiveNumCtx = numCtx;
      let oomHalvings = 0;
      const taskResults: TaskResult[] = [];
      let modelFailed = false;
      let modelError = "";

      taskLoop: while (true) {
        taskResults.length = 0;
        modelFailed = false;
        modelError = "";

        for (const task of BENCHMARK_TASKS) {
          const result = await runTask(ollamaClient, model, task.prompt, iterations, effectiveNumCtx);

          if ("status" in result && result.status === "ERROR") {
            if (result.oom && opts.autoRetryOnOverflow && oomHalvings < MAX_OOM_HALVINGS) {
              // OOM — halve context and retry the whole model from scratch
              const oldCtx = effectiveNumCtx ?? 0;
              effectiveNumCtx = oldCtx > 0
                ? Math.floor(oldCtx / 2)
                : 2048; // fallback starting point if no ctx was set
              oomHalvings++;
              opts.onOomRetry?.(model, oldCtx, effectiveNumCtx);
              continue taskLoop;
            }
            // Non-OOM error, or OOM with retries exhausted
            modelFailed = true;
            modelError = oomHalvings > 0
              ? `OOM after ${oomHalvings} context reduction(s) (final ctx=${effectiveNumCtx}): ${result.error}`
              : result.error;
            break taskLoop;
          }

          taskResults.push({
            taskName: task.name,
            metrics: result as TaskMetricsWithStats,
          });
        }

        // All tasks completed successfully
        break;
      }

      if (modelFailed) {
        modelResults.push({
          model,
          modelInfo,
          tasks: [],
          status: "ERROR",
          error: modelError,
          ...(effectiveNumCtx !== undefined ? { effectiveNumCtx } : {}),
        });
      } else {
        modelResults.push({
          model,
          modelInfo,
          tasks: taskResults,
          ...(effectiveNumCtx !== undefined ? { effectiveNumCtx } : {}),
        });
      }
    }

    const report: BenchmarkReport = {
      models: modelResults,
      generatedAt: new Date().toISOString(),
      flashAttention: process.env["OLLAMA_FLASH_ATTENTION"] === "1",
      contextOverrides: opts.contextOverrides,
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
    return { content: [{ type: "text" as const, text }], report };
  };
}
