/**
 * Unit tests for src/advisor/recommendation_engine.ts
 */

import { describe, it, expect } from "vitest";
import {
  selectFastest,
  selectMostContext,
  selectBestFa,
  computeBestOverall,
  generateRecommendations,
} from "../../advisor/recommendation_engine.js";
import type { BenchmarkRunResult, HardwareInfo } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  modelName: string,
  throughput: number,
  contextWindow: number,
  vramEstimateMb: number,
  flashAttentionEnabled = false,
  memoryMode: "gpu_native" | "ram_assisted" = "gpu_native",
  latencyMs = 100
): BenchmarkRunResult {
  return {
    modelName,
    throughputTokensPerSec: throughput,
    contextWindow,
    vramEstimateMb,
    flashAttentionEnabled,
    memoryMode,
    latencyMs,
    parametersBillions: 7,
  };
}

const HARDWARE: HardwareInfo = {
  gpuName: "NVIDIA RTX 4090",
  totalVramMb: 24576,
  safetyMarginPct: 10,
  vramBudgetMb: 22118,
  systemRamMb: 65536,
  cpuOnly: false,
};

// ---------------------------------------------------------------------------
// selectFastest
// ---------------------------------------------------------------------------

describe("selectFastest", () => {
  it("selects the model with higher throughput", () => {
    const results = [
      makeResult("slow-model", 10, 4096, 4096),
      makeResult("fast-model", 50, 4096, 4096),
    ];
    const rec = selectFastest(results);
    expect(rec.modelName).toBe("fast-model");
    expect(rec.category).toBe("fastest");
  });

  it("tie-breaks by lower VRAM when throughput is equal", () => {
    const results = [
      makeResult("big-model", 50, 4096, 8192),
      makeResult("small-model", 50, 4096, 4096),
    ];
    const rec = selectFastest(results);
    expect(rec.modelName).toBe("small-model");
  });

  it("prefers FA-enabled results when available", () => {
    const results = [
      makeResult("model-a", 30, 4096, 4096, false),
      makeResult("model-a", 50, 4096, 4096, true),
      makeResult("model-b", 40, 4096, 4096, false),
    ];
    const rec = selectFastest(results);
    expect(rec.modelName).toBe("model-a");
    expect(rec.flashAttentionEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectMostContext
// ---------------------------------------------------------------------------

describe("selectMostContext", () => {
  it("selects the model with the larger context window", () => {
    const results = [
      makeResult("small-ctx", 30, 4096, 4096),
      makeResult("large-ctx", 30, 32768, 4096),
    ];
    const rec = selectMostContext(results);
    expect(rec.modelName).toBe("large-ctx");
    expect(rec.category).toBe("most_context");
  });

  it("tie-breaks by lower VRAM when context windows are equal", () => {
    const results = [
      makeResult("big-model", 30, 32768, 8192),
      makeResult("small-model", 30, 32768, 4096),
    ];
    const rec = selectMostContext(results);
    expect(rec.modelName).toBe("small-model");
  });
});

// ---------------------------------------------------------------------------
// selectBestFa
// ---------------------------------------------------------------------------

describe("selectBestFa", () => {
  it("selects the model with the greatest FA improvement", () => {
    const results = [
      makeResult("model-a", 30, 4096, 4096, false),
      makeResult("model-a", 40, 4096, 4096, true),  // +10 improvement
      makeResult("model-b", 30, 4096, 4096, false),
      makeResult("model-b", 35, 4096, 4096, true),  // +5 improvement
    ];
    const rec = selectBestFa(results);
    expect(rec.modelName).toBe("model-a");
    expect(rec.category).toBe("fa");
  });

  it("falls back to selectFastest behavior when no model has both FA-on and FA-off", () => {
    const results = [
      makeResult("model-a", 50, 4096, 4096, true),
      makeResult("model-b", 30, 4096, 4096, true),
    ];
    const rec = selectBestFa(results);
    // Falls back to fastest (model-a has higher throughput)
    expect(rec.modelName).toBe("model-a");
    expect(rec.category).toBe("fa");
  });
});

// ---------------------------------------------------------------------------
// computeBestOverall
// ---------------------------------------------------------------------------

describe("computeBestOverall", () => {
  it("single model → returns that model with a numeric score", () => {
    const results = [makeResult("only-model", 50, 32768, 4096)];
    const rec = computeBestOverall(results);
    expect(rec.modelName).toBe("only-model");
    expect(rec.category).toBe("best_overall");
    expect(typeof rec.score).toBe("number");
  });

  it("multiple models → returns a model with a numeric score", () => {
    const results = [
      makeResult("model-a", 50, 32768, 4096),
      makeResult("model-b", 30, 8192, 8192),
    ];
    const rec = computeBestOverall(results);
    expect(rec.category).toBe("best_overall");
    expect(typeof rec.score).toBe("number");
    expect(rec.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// generateRecommendations
// ---------------------------------------------------------------------------

describe("generateRecommendations", () => {
  it("throws an error when results is empty", () => {
    expect(() =>
      generateRecommendations([], HARDWARE, "vram_only", [])
    ).toThrow();
  });

  it("returns a report with all 4 recommendation categories", () => {
    const results = [
      makeResult("model-a", 50, 32768, 4096, true),
      makeResult("model-a", 40, 32768, 4096, false),
      makeResult("model-b", 30, 8192, 8192),
    ];
    const report = generateRecommendations(results, HARDWARE, "vram_only", []);
    expect(report.recommendations.fastest).toBeDefined();
    expect(report.recommendations.most_context).toBeDefined();
    expect(report.recommendations.fa).toBeDefined();
    expect(report.recommendations.best_overall).toBeDefined();
  });

  it("sets ramAssistedNotice on RAM-assisted model recommendations", () => {
    const results = [
      makeResult("ram-model", 15, 4096, 12000, false, "ram_assisted"),
    ];
    const report = generateRecommendations(results, HARDWARE, "ram_assisted", []);
    expect(report.recommendations.fastest.ramAssistedNotice).toBeDefined();
    expect(report.recommendations.fastest.ramAssistedNotice).toContain("CPU offload");
  });
});
