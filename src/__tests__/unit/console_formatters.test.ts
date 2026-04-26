/**
 * Unit tests for src/console/formatters.ts
 *
 * Requirements: 3.2, 5.1, 5.2, 5.4, 6.1, 6.2, 6.4, 7.2, 7.5
 */

import { describe, it, expect } from "vitest";
import {
  formatModelList,
  formatPingResult,
  formatConfig,
  formatCapabilityMap,
  formatReductionStats,
  formatCheckResults,
  formatReductionRatio,
  formatBenchmarkReport,
} from "../../console/formatters.js";
import type { BridgeConfig } from "../../types.js";
import type { CheckResult } from "../../tools/test_config.js";
import type { ReductionStats } from "../../logging/reduction_logger.js";

// ---------------------------------------------------------------------------
// formatModelList
// ---------------------------------------------------------------------------

describe("formatModelList", () => {
  it("returns a 'no models' message for an empty array", () => {
    const result = formatModelList([]);
    expect(result).toContain("No models available");
  });

  it("returns the single model name for a one-element array", () => {
    const result = formatModelList(["llama3.1:8b"]);
    expect(result).toContain("llama3.1:8b");
  });

  it("returns all model names for a multi-element array", () => {
    const models = ["llama3.1:8b", "mistral:7b", "codellama:13b"];
    const result = formatModelList(models);
    for (const model of models) {
      expect(result).toContain(model);
    }
  });

  it("puts each model on its own line", () => {
    const models = ["model-a", "model-b", "model-c"];
    const result = formatModelList(models);
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("model-a");
    expect(lines[1]).toBe("model-b");
    expect(lines[2]).toBe("model-c");
  });
});

// ---------------------------------------------------------------------------
// formatPingResult
// ---------------------------------------------------------------------------

describe("formatPingResult", () => {
  it("shows 'warm' when loaded is true", () => {
    const result = formatPingResult("llama3.1:8b", { loaded: true, responseTimeMs: 42 });
    expect(result).toContain("warm");
    expect(result).not.toContain("cold");
  });

  it("shows 'cold' when loaded is false", () => {
    const result = formatPingResult("llama3.1:8b", { loaded: false, responseTimeMs: 100 });
    expect(result).toContain("cold");
    expect(result).not.toContain("warm");
  });

  it("contains the model name", () => {
    const result = formatPingResult("mistral:7b", { loaded: true, responseTimeMs: 55 });
    expect(result).toContain("mistral:7b");
  });

  it("contains the numeric response time in ms", () => {
    const result = formatPingResult("llama3.1:8b", { loaded: true, responseTimeMs: 123 });
    expect(result).toContain("123");
  });
});

// ---------------------------------------------------------------------------
// formatConfig
// ---------------------------------------------------------------------------

const BASE_CONFIG: BridgeConfig = {
  ollamaBaseUrl: "http://localhost:11434",
  defaultModel: "llama3.1:8b",
  contextWindow: 4096,
  keepAlive: "10m",
  keepAliveOnStart: false,
  allowedDirs: ["/home/user"],
  allowedDirsExplicit: false,
  systemPrompt: "You are a helpful assistant.",
  capabilityMap: {},
  fallbackModels: [],
  queueMaxSize: 10,
  numParallel: 1,
  requestTimeoutMs: 300000,
  reductionLogPath: "./orchestrama-reductions.jsonl",
  logLevel: "info",
  disableProgress: false,
};

describe("formatConfig", () => {
  it("contains every BridgeConfig field name", () => {
    const result = formatConfig(BASE_CONFIG);
    const fieldNames: (keyof BridgeConfig)[] = [
      "ollamaBaseUrl",
      "defaultModel",
      "contextWindow",
      "keepAlive",
      "keepAliveOnStart",
      "allowedDirs",
      "systemPrompt",
      "capabilityMap",
      "fallbackModels",
      "queueMaxSize",
      "numParallel",
      "requestTimeoutMs",
      "reductionLogPath",
      "logLevel",
      "disableProgress",
    ];
    for (const field of fieldNames) {
      expect(result).toContain(field);
    }
  });

  it("shows '(empty)' for an empty capabilityMap", () => {
    const result = formatConfig({ ...BASE_CONFIG, capabilityMap: {} });
    expect(result).toContain("(empty)");
  });

  it("formats capabilityMap entries as pattern → model pairs", () => {
    const config: BridgeConfig = {
      ...BASE_CONFIG,
      capabilityMap: { "code.*": "codellama:13b", "log.*": "mistral:7b" },
    };
    const result = formatConfig(config);
    expect(result).toContain("code.*");
    expect(result).toContain("codellama:13b");
    expect(result).toContain("log.*");
    expect(result).toContain("mistral:7b");
    expect(result).toContain("→");
  });

  it("includes benchmarkOutputFile when present", () => {
    const config: BridgeConfig = {
      ...BASE_CONFIG,
      benchmarkOutputFile: "/tmp/bench.json",
    };
    const result = formatConfig(config);
    expect(result).toContain("benchmarkOutputFile");
    expect(result).toContain("/tmp/bench.json");
  });
});

// ---------------------------------------------------------------------------
// formatCapabilityMap
// ---------------------------------------------------------------------------

describe("formatCapabilityMap", () => {
  it("shows '(empty)' for an empty map", () => {
    const result = formatCapabilityMap({});
    expect(result).toContain("(empty)");
  });

  it("lists every pattern→model pair", () => {
    const map = { "code.*": "codellama:13b", "log.*": "mistral:7b" };
    const result = formatCapabilityMap(map);
    expect(result).toContain("code.*");
    expect(result).toContain("codellama:13b");
    expect(result).toContain("log.*");
    expect(result).toContain("mistral:7b");
    expect(result).toContain("→");
  });

  it("does not include resolved model when resolved is not provided", () => {
    const map = { "code.*": "codellama:13b" };
    const result = formatCapabilityMap(map);
    expect(result).not.toContain("Resolved model");
  });

  it("appends the resolved model name when resolved is provided", () => {
    const map = { "code.*": "codellama:13b" };
    const result = formatCapabilityMap(map, {
      prompt: "review this code",
      model: "codellama:13b",
    });
    expect(result).toContain("codellama:13b");
    expect(result).toContain("review this code");
  });
});

// ---------------------------------------------------------------------------
// formatReductionStats
// ---------------------------------------------------------------------------

const EMPTY_STATS: ReductionStats = {
  totalInvocations: 0,
  averageReductionRatio: 0,
  totalTokensSaved: 0,
  byModel: {},
  byTaskType: {},
};

describe("formatReductionStats", () => {
  it("contains totalInvocations", () => {
    const result = formatReductionStats(EMPTY_STATS);
    expect(result).toContain("totalInvocations");
    expect(result).toContain("0");
  });

  it("contains averageReductionRatio as a percentage", () => {
    const stats: ReductionStats = { ...EMPTY_STATS, averageReductionRatio: 0.312 };
    const result = formatReductionStats(stats);
    expect(result).toContain("averageReductionRatio");
    expect(result).toContain("31.2%");
  });

  it("contains totalTokensSaved", () => {
    const stats: ReductionStats = { ...EMPTY_STATS, totalTokensSaved: 500 };
    const result = formatReductionStats(stats);
    expect(result).toContain("totalTokensSaved");
    expect(result).toContain("500");
  });

  it("contains every key from byModel", () => {
    const stats: ReductionStats = {
      ...EMPTY_STATS,
      byModel: {
        "llama3.1:8b": { invocations: 5, averageReductionRatio: 0.4 },
        "mistral:7b": { invocations: 3, averageReductionRatio: 0.2 },
      },
    };
    const result = formatReductionStats(stats);
    expect(result).toContain("llama3.1:8b");
    expect(result).toContain("mistral:7b");
  });

  it("contains every key from byTaskType", () => {
    const stats: ReductionStats = {
      ...EMPTY_STATS,
      byTaskType: {
        code_review: { invocations: 2, averageReductionRatio: 0.5 },
        log_analysis: { invocations: 1, averageReductionRatio: 0.3 },
      },
    };
    const result = formatReductionStats(stats);
    expect(result).toContain("code_review");
    expect(result).toContain("log_analysis");
  });
});

// ---------------------------------------------------------------------------
// formatCheckResults
// ---------------------------------------------------------------------------

describe("formatCheckResults", () => {
  it("shows ✅ for PASS results", () => {
    const checks: CheckResult[] = [
      { name: "Ollama connectivity", status: "PASS", message: "OK" },
    ];
    const result = formatCheckResults(checks);
    expect(result).toContain("✅");
  });

  it("shows ❌ for FAIL results", () => {
    const checks: CheckResult[] = [
      { name: "Ollama connectivity", status: "FAIL", message: "Cannot connect" },
    ];
    const result = formatCheckResults(checks);
    expect(result).toContain("❌");
  });

  it("shows ⏭️ for SKIPPED results", () => {
    const checks: CheckResult[] = [
      { name: "End-to-end call", status: "SKIPPED", message: "Skipped" },
    ];
    const result = formatCheckResults(checks);
    expect(result).toContain("⏭️");
  });

  it("includes resolution hint for FAIL results that have one", () => {
    const checks: CheckResult[] = [
      {
        name: "Ollama connectivity",
        status: "FAIL",
        message: "Cannot connect",
        resolution: "Run `ollama serve`",
      },
    ];
    const result = formatCheckResults(checks);
    expect(result).toContain("Run `ollama serve`");
  });

  it("does not include resolution hint for FAIL results without one", () => {
    const checks: CheckResult[] = [
      { name: "Ollama connectivity", status: "FAIL", message: "Cannot connect" },
    ];
    const result = formatCheckResults(checks);
    expect(result).not.toContain("💡");
  });

  it("shows all-pass summary when all checks pass", () => {
    const checks: CheckResult[] = [
      { name: "Check A", status: "PASS", message: "OK" },
      { name: "Check B", status: "PASS", message: "OK" },
    ];
    const result = formatCheckResults(checks);
    expect(result).toContain("All checks passed");
  });

  it("lists all failed check names in summary when at least one fails", () => {
    const checks: CheckResult[] = [
      { name: "Ollama connectivity", status: "FAIL", message: "Cannot connect" },
      { name: "Default model existence", status: "PASS", message: "OK" },
      { name: "End-to-end call", status: "FAIL", message: "Failed" },
    ];
    const result = formatCheckResults(checks);
    expect(result).toContain("Ollama connectivity");
    expect(result).toContain("End-to-end call");
    // Summary should list failed checks
    const summarySection = result.split("=".repeat(40)).pop() ?? "";
    expect(summarySection).toContain("Ollama connectivity");
    expect(summarySection).toContain("End-to-end call");
  });

  it("handles mixed PASS/FAIL/SKIPPED results", () => {
    const checks: CheckResult[] = [
      { name: "Check A", status: "PASS", message: "OK" },
      { name: "Check B", status: "FAIL", message: "Failed", resolution: "Fix it" },
      { name: "Check C", status: "SKIPPED", message: "Skipped" },
    ];
    const result = formatCheckResults(checks);
    expect(result).toContain("✅");
    expect(result).toContain("❌");
    expect(result).toContain("⏭️");
    expect(result).toContain("Fix it");
  });
});

// ---------------------------------------------------------------------------
// formatReductionRatio
// ---------------------------------------------------------------------------

describe("formatReductionRatio", () => {
  it("formats 0 as '0.0%'", () => {
    expect(formatReductionRatio(0)).toBe("0.0%");
  });

  it("formats 0.5 as '50.0%'", () => {
    expect(formatReductionRatio(0.5)).toBe("50.0%");
  });

  it("formats 1 as '100.0%'", () => {
    expect(formatReductionRatio(1)).toBe("100.0%");
  });

  it("formats 0.312 as '31.2%'", () => {
    expect(formatReductionRatio(0.312)).toBe("31.2%");
  });
});

// ---------------------------------------------------------------------------
// formatBenchmarkReport
// ---------------------------------------------------------------------------

describe("formatBenchmarkReport", () => {
  it("contains every model name from the results", () => {
    const results = [
      { model: "llama3.1:8b", tasks: [] },
      { model: "mistral:7b", tasks: [] },
    ];
    const output = formatBenchmarkReport(results);
    expect(output).toContain("llama3.1:8b");
    expect(output).toContain("mistral:7b");
  });

  it("shows error info for models with status ERROR", () => {
    const results = [
      { model: "bad-model", status: "ERROR", error: "OOM error", tasks: [] },
    ];
    const output = formatBenchmarkReport(results);
    expect(output).toContain("bad-model");
    expect(output).toContain("ERROR");
    expect(output).toContain("OOM error");
  });

  it("handles empty results array", () => {
    const output = formatBenchmarkReport([]);
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });
});
