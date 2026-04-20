/**
 * Unit tests for src/advisor/report_formatter.ts
 */

import { describe, it, expect } from "vitest";
import {
  formatHardwareSummary,
  formatRecommendationTable,
  formatExclusionSummary,
  formatRamAssistedSection,
  formatRecommendationReport,
} from "../../advisor/report_formatter.js";
import type {
  HardwareInfo,
  Recommendation,
  RecommendationCategory,
  RecommendationReport,
  BenchmarkRunResult,
} from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HARDWARE: HardwareInfo = {
  gpuName: "NVIDIA RTX 4090",
  totalVramMb: 24576,
  safetyMarginPct: 10,
  vramBudgetMb: 22118,
  systemRamMb: 65536,
  cpuOnly: false,
};

function makeRecommendation(
  category: RecommendationCategory,
  modelName = "llama3:7b",
  contextWindow = 32768,
  throughput = 45.5,
  latencyMs = 220,
  vramEstimateMb = 4096,
  flashAttentionEnabled = true,
  memoryMode: "gpu_native" | "ram_assisted" = "gpu_native"
): Recommendation {
  return {
    category,
    modelName,
    contextWindow,
    throughputTokensPerSec: throughput,
    latencyMs,
    vramEstimateMb,
    flashAttentionEnabled,
    memoryMode,
    parametersBillions: 7,
  };
}

const RECOMMENDATIONS: Record<RecommendationCategory, Recommendation> = {
  fastest: makeRecommendation("fastest"),
  most_context: makeRecommendation("most_context"),
  fa: makeRecommendation("fa"),
  best_overall: { ...makeRecommendation("best_overall"), score: 0.95 },
  most_parameters: makeRecommendation("most_parameters"),
};

function makeReport(): RecommendationReport {
  return {
    hardware: HARDWARE,
    memoryMode: "vram_only",
    recommendations: RECOMMENDATIONS,
    exclusions: [],
    allResults: [],
    generatedAt: "2024-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// formatHardwareSummary
// ---------------------------------------------------------------------------

describe("formatHardwareSummary", () => {
  it("contains GPU name", () => {
    const result = formatHardwareSummary(HARDWARE, "vram_only");
    expect(result).toContain("NVIDIA RTX 4090");
  });

  it("contains total VRAM", () => {
    const result = formatHardwareSummary(HARDWARE, "vram_only");
    expect(result).toContain("24,576");
  });

  it("contains safety margin percentage", () => {
    const result = formatHardwareSummary(HARDWARE, "vram_only");
    expect(result).toContain("10%");
  });

  it("contains VRAM budget", () => {
    const result = formatHardwareSummary(HARDWARE, "vram_only");
    expect(result).toContain("22,118");
  });

  it("contains system RAM", () => {
    const result = formatHardwareSummary(HARDWARE, "vram_only");
    expect(result).toContain("65,536");
  });

  it("contains 'VRAM-only' for vram_only mode", () => {
    const result = formatHardwareSummary(HARDWARE, "vram_only");
    expect(result).toContain("VRAM-only");
  });

  it("contains 'RAM-assisted' for ram_assisted mode", () => {
    const result = formatHardwareSummary(HARDWARE, "ram_assisted");
    expect(result).toContain("RAM-assisted");
  });
});

// ---------------------------------------------------------------------------
// formatRecommendationTable
// ---------------------------------------------------------------------------

describe("formatRecommendationTable", () => {
  it("contains all 8 column headers", () => {
    const result = formatRecommendationTable(RECOMMENDATIONS);
    expect(result).toContain("Category");
    expect(result).toContain("Model");
    expect(result).toContain("Context Window");
    expect(result).toContain("Throughput");
    expect(result).toContain("Latency");
    expect(result).toContain("VRAM");
    expect(result).toContain("FA");
    expect(result).toContain("Memory Mode");
  });

  it("contains '★' for the best_overall row", () => {
    const result = formatRecommendationTable(RECOMMENDATIONS);
    expect(result).toContain("★");
  });

  it("contains model names from recommendations", () => {
    const result = formatRecommendationTable(RECOMMENDATIONS);
    expect(result).toContain("llama3:7b");
  });
});

// ---------------------------------------------------------------------------
// formatExclusionSummary
// ---------------------------------------------------------------------------

describe("formatExclusionSummary", () => {
  it("empty exclusions → '(none)'", () => {
    const result = formatExclusionSummary([]);
    expect(result).toContain("(none)");
  });

  it("one exclusion → contains model name and reason", () => {
    const exclusions = [
      { modelName: "llama3:70b", reason: "Requires 36352 MB VRAM; exceeds VRAM budget of 22118 MB" },
    ];
    const result = formatExclusionSummary(exclusions);
    expect(result).toContain("llama3:70b");
    expect(result).toContain("Requires 36352 MB VRAM");
  });

  it("multiple exclusions → contains all model names and reasons", () => {
    const exclusions = [
      { modelName: "llama3:70b", reason: "Too large" },
      { modelName: "mixtral:8x7b", reason: "Exceeds budget" },
    ];
    const result = formatExclusionSummary(exclusions);
    expect(result).toContain("llama3:70b");
    expect(result).toContain("Too large");
    expect(result).toContain("mixtral:8x7b");
    expect(result).toContain("Exceeds budget");
  });
});

// ---------------------------------------------------------------------------
// formatRamAssistedSection
// ---------------------------------------------------------------------------

describe("formatRamAssistedSection", () => {
  it("no RAM-assisted results → returns empty string", () => {
    const results: BenchmarkRunResult[] = [
      {
        modelName: "llama3:7b",
        contextWindow: 32768,
        throughputTokensPerSec: 45.5,
        latencyMs: 220,
        vramEstimateMb: 4096,
        flashAttentionEnabled: true,
        memoryMode: "gpu_native",
        parametersBillions: 7,
      },
    ];
    expect(formatRamAssistedSection(results)).toBe("");
  });

  it("one RAM-assisted result → contains model name, tok/s, ms, MB", () => {
    const results: BenchmarkRunResult[] = [
      {
        modelName: "llama3:13b",
        contextWindow: 8192,
        throughputTokensPerSec: 12.3,
        latencyMs: 810,
        vramEstimateMb: 7168,
        flashAttentionEnabled: false,
        memoryMode: "ram_assisted",
        parametersBillions: 7,
      },
    ];
    const result = formatRamAssistedSection(results);
    expect(result).toContain("llama3:13b");
    expect(result).toContain("tok/s");
    expect(result).toContain("ms");
    expect(result).toContain("MB");
  });
});

// ---------------------------------------------------------------------------
// formatRecommendationReport
// ---------------------------------------------------------------------------

describe("formatRecommendationReport", () => {
  it("contains 'Benchmark Advisor Report'", () => {
    const result = formatRecommendationReport(makeReport());
    expect(result).toContain("Benchmark Advisor Report");
  });

  it("contains '★' for best_overall", () => {
    const result = formatRecommendationReport(makeReport());
    expect(result).toContain("★");
  });

  it("contains hardware summary section", () => {
    const result = formatRecommendationReport(makeReport());
    expect(result).toContain("Hardware Summary");
    expect(result).toContain("NVIDIA RTX 4090");
  });

  it("contains exclusion summary section", () => {
    const result = formatRecommendationReport(makeReport());
    expect(result).toContain("Excluded Models");
  });
});
