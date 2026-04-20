/**
 * Pure formatting functions for the Human Console output.
 *
 * All functions are side-effect-free (no I/O), making them straightforward
 * to test with property-based testing.
 *
 * Requirements: 3.2, 5.1, 5.2, 5.4, 6.1, 6.2, 6.4, 7.2, 7.5
 */

import type { BridgeConfig, CapabilityMap } from "../types.js";
import type { CheckResult } from "../tools/test_config.js";
import type { ReductionStats } from "../logging/reduction_logger.js";

// ---------------------------------------------------------------------------
// formatModelList
// ---------------------------------------------------------------------------

/**
 * Formats a list of model names for display.
 * Each model name appears on its own line.
 * An empty list returns a "no models" message.
 */
export function formatModelList(models: string[]): string {
  if (models.length === 0) {
    return "No models available.";
  }
  return models.join("\n");
}

// ---------------------------------------------------------------------------
// formatPingResult
// ---------------------------------------------------------------------------

/**
 * Formats the result of a ping operation.
 * Contains the model name, warm/cold status, and numeric response time in ms.
 */
export function formatPingResult(
  model: string,
  result: { loaded: boolean; responseTimeMs: number }
): string {
  const status = result.loaded ? "warm" : "cold";
  return `Model: ${model}\nStatus: ${status}\nResponse time: ${result.responseTimeMs}ms`;
}

// ---------------------------------------------------------------------------
// formatConfig
// ---------------------------------------------------------------------------

/**
 * Formats the full BridgeConfig for display.
 * Contains every field name and its string representation.
 * Formats capabilityMap entries as `pattern → model` pairs.
 */
export function formatConfig(config: BridgeConfig): string {
  const lines: string[] = ["Bridge Configuration", "=".repeat(40)];

  lines.push(`ollamaBaseUrl: ${config.ollamaBaseUrl}`);
  lines.push(`defaultModel: ${config.defaultModel}`);
  lines.push(`contextWindow: ${config.contextWindow}`);
  lines.push(`keepAlive: ${config.keepAlive}`);
  lines.push(`keepAliveOnStart: ${config.keepAliveOnStart}`);
  lines.push(`allowedDirs: ${config.allowedDirs.join(", ")}`);
  lines.push(`systemPrompt: ${config.systemPrompt}`);

  // capabilityMap entries as pattern → model pairs
  const mapEntries = Object.entries(config.capabilityMap);
  if (mapEntries.length === 0) {
    lines.push(`capabilityMap: (empty)`);
  } else {
    lines.push(`capabilityMap:`);
    for (const [pattern, model] of mapEntries) {
      lines.push(`  ${pattern} → ${model}`);
    }
  }

  lines.push(`fallbackModels: ${config.fallbackModels.join(", ")}`);
  lines.push(`queueMaxSize: ${config.queueMaxSize}`);
  lines.push(`numParallel: ${config.numParallel}`);
  lines.push(`requestTimeoutMs: ${config.requestTimeoutMs}`);
  lines.push(`maxContextFiles: ${config.maxContextFiles ?? 20}`);
  lines.push(`maxFileTokens: ${config.maxFileTokens ?? 1024}`);
  lines.push(`maxTotalContextTokens: ${config.maxTotalContextTokens ?? 4096}`);
  lines.push(`reductionLogPath: ${config.reductionLogPath}`);
  lines.push(`logLevel: ${config.logLevel}`);
  lines.push(`disableProgress: ${config.disableProgress}`);

  if (config.benchmarkOutputFile !== undefined) {
    lines.push(`benchmarkOutputFile: ${config.benchmarkOutputFile}`);
  }

  // Model fine-tuning options
  const opts = config.modelOptions;
  if (opts && Object.keys(opts).length > 0) {
    lines.push(`modelOptions:`);
    for (const [k, v] of Object.entries(opts)) {
      lines.push(`  ${k}: ${v}`);
    }
  } else {
    lines.push(`modelOptions: (model defaults)`);
  }

  lines.push(`autoRetryOnOverflow: ${config.autoRetryOnOverflow ?? false}`);
  lines.push(
    `flashAttention: ${config.flashAttention ?? false}` +
      (config.flashAttention ? "" : "  (requires Ollama restart to take effect)")
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatCapabilityMap
// ---------------------------------------------------------------------------

/**
 * Formats the capability map for display.
 * Lists every pattern→model pair.
 * If `resolved` is provided, appends the resolved model name.
 */
export function formatCapabilityMap(
  map: CapabilityMap,
  resolved?: { prompt: string; model: string }
): string {
  const lines: string[] = ["Capability Map", "=".repeat(40)];

  const entries = Object.entries(map);
  if (entries.length === 0) {
    lines.push("  (empty)");
  } else {
    for (const [pattern, model] of entries) {
      lines.push(`  ${pattern} → ${model}`);
    }
  }

  if (resolved !== undefined) {
    lines.push("");
    lines.push(`Resolved model for prompt "${resolved.prompt}": ${resolved.model}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatReductionRatio
// ---------------------------------------------------------------------------

/**
 * Formats a reduction ratio (0–1) as a percentage string.
 * e.g. 0.312 → "31.2%"
 */
export function formatReductionRatio(ratio: number): string {
  return (ratio * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// formatReductionStats
// ---------------------------------------------------------------------------

/**
 * Formats aggregate reduction statistics for display.
 * Contains totalInvocations, averageReductionRatio as a percentage,
 * totalTokensSaved, and every key from byModel and byTaskType.
 */
export function formatReductionStats(stats: ReductionStats): string {
  const lines: string[] = ["Reduction Statistics", "=".repeat(40)];

  lines.push(`totalInvocations: ${stats.totalInvocations}`);
  lines.push(`averageReductionRatio: ${formatReductionRatio(stats.averageReductionRatio)}`);
  lines.push(`totalTokensSaved: ${stats.totalTokensSaved}`);

  lines.push("");
  lines.push("By model:");
  const modelEntries = Object.entries(stats.byModel);
  if (modelEntries.length === 0) {
    lines.push("  (none)");
  } else {
    for (const [model, data] of modelEntries) {
      lines.push(
        `  ${model}: ${data.invocations} invocations, avg ratio ${formatReductionRatio(data.averageReductionRatio)}`
      );
    }
  }

  lines.push("");
  lines.push("By task type:");
  const taskTypeEntries = Object.entries(stats.byTaskType);
  if (taskTypeEntries.length === 0) {
    lines.push("  (none)");
  } else {
    for (const [taskType, data] of taskTypeEntries) {
      lines.push(
        `  ${taskType}: ${data.invocations} invocations, avg ratio ${formatReductionRatio(data.averageReductionRatio)}`
      );
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatCheckResults
// ---------------------------------------------------------------------------

/**
 * Formats an array of health check results for display.
 * Uses ✅ for PASS, ❌ for FAIL, ⏭️ for SKIPPED.
 * Includes resolution hint for every FAIL that has one.
 * Lists all failed check names in a summary when at least one fails.
 */
export function formatCheckResults(checks: CheckResult[]): string {
  const lines: string[] = ["Configuration Health Check", "=".repeat(40)];

  const failedNames: string[] = [];

  for (const check of checks) {
    let icon: string;
    if (check.status === "PASS") {
      icon = "✅";
    } else if (check.status === "FAIL") {
      icon = "❌";
      failedNames.push(check.name);
    } else {
      icon = "⏭️";
    }

    const timeStr =
      check.responseTimeMs !== undefined ? ` [${check.responseTimeMs}ms]` : "";
    lines.push(`\n${icon} ${check.name}${timeStr}`);
    lines.push(`   ${check.message}`);

    if (check.status === "FAIL" && check.resolution) {
      lines.push(`   💡 ${check.resolution}`);
    }
  }

  lines.push("\n" + "=".repeat(40));

  if (failedNames.length === 0) {
    lines.push("✅ All checks passed");
  } else {
    lines.push("❌ Some checks failed:");
    for (const name of failedNames) {
      lines.push(`  - ${name}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatBenchmarkReport
// ---------------------------------------------------------------------------

/**
 * Formats a benchmark report for display.
 * Contains every model name from the results.
 * Shows error info for models with status === "ERROR".
 */
export function formatBenchmarkReport(
  results: Array<{
    model: string;
    tasks?: unknown[];
    status?: string;
    error?: string;
  }>
): string {
  const lines: string[] = ["Benchmark Report", "=".repeat(60)];

  for (const result of results) {
    lines.push(`\nModel: ${result.model}`);

    if (result.status === "ERROR") {
      lines.push(`  Status: ERROR — ${result.error ?? "unknown error"}`);
      continue;
    }

    if (Array.isArray(result.tasks) && result.tasks.length > 0) {
      for (const task of result.tasks) {
        if (task == null || typeof task !== "object") continue;
        const t = task as Record<string, unknown>;
        if (t["taskName"]) {
          lines.push(`  Task: ${t["taskName"]}`);
          const m = t["metrics"] as Record<string, unknown> | undefined;
          if (m) {
            if (typeof m["latency"] === "number") {
              lines.push(`    Latency: ${(m["latency"] as number).toFixed(1)} ms`);
            }
            if (typeof m["throughput"] === "number") {
              lines.push(`    Throughput: ${(m["throughput"] as number).toFixed(2)} tokens/s`);
            }
            if (typeof m["responseLength"] === "number") {
              lines.push(`    Response len: ${(m["responseLength"] as number).toFixed(0)} chars`);
            }
          }
        }
      }
    } else {
      lines.push("  No task results.");
    }
  }

  return lines.join("\n");
}
