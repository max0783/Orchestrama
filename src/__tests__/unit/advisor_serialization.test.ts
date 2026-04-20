/**
 * Unit tests for src/advisor/serialization.ts
 */

import { describe, it, expect } from "vitest";
import { serializeReport, parseReport } from "../../advisor/serialization.js";
import type {
  RecommendationReport,
  HardwareInfo,
  Recommendation,
  RecommendationCategory,
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

function makeRecommendation(category: RecommendationCategory): Recommendation {
  return {
    category,
    modelName: "llama3:7b",
    contextWindow: 32768,
    throughputTokensPerSec: 45.5,
    latencyMs: 220,
    vramEstimateMb: 4096,
    flashAttentionEnabled: true,
    memoryMode: "gpu_native",
    parametersBillions: 7,
  };
}

function makeReport(): RecommendationReport {
  return {
    hardware: HARDWARE,
    memoryMode: "vram_only",
    recommendations: {
      fastest: makeRecommendation("fastest"),
      most_context: makeRecommendation("most_context"),
      fa: makeRecommendation("fa"),
      best_overall: { ...makeRecommendation("best_overall"), score: 0.95 },
      most_parameters: { ...makeRecommendation("best_overall"), category: "most_parameters" },
    },
    exclusions: [
      { modelName: "llama3:70b", reason: "Exceeds VRAM budget" },
    ],
    allResults: [
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
    ],
    generatedAt: "2024-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// serializeReport
// ---------------------------------------------------------------------------

describe("serializeReport", () => {
  it("returns a valid JSON string", () => {
    const json = serializeReport(makeReport());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('contains "version": "1"', () => {
    const json = serializeReport(makeReport());
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("1");
  });

  it("contains the model name from recommendations", () => {
    const json = serializeReport(makeReport());
    expect(json).toContain("llama3:7b");
  });

  it("contains the generatedAt timestamp", () => {
    const json = serializeReport(makeReport());
    expect(json).toContain("2024-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// parseReport
// ---------------------------------------------------------------------------

describe("parseReport", () => {
  it("parses a valid serialized report back to a RecommendationReport", () => {
    const report = makeReport();
    const json = serializeReport(report);
    const parsed = parseReport(json);
    expect(parsed.hardware.gpuName).toBe("NVIDIA RTX 4090");
    expect(parsed.memoryMode).toBe("vram_only");
    expect(parsed.generatedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("reconstructs hardware fields correctly", () => {
    const report = makeReport();
    const parsed = parseReport(serializeReport(report));
    expect(parsed.hardware.totalVramMb).toBe(24576);
    expect(parsed.hardware.safetyMarginPct).toBe(10);
    expect(parsed.hardware.vramBudgetMb).toBe(22118);
    expect(parsed.hardware.systemRamMb).toBe(65536);
    expect(parsed.hardware.cpuOnly).toBe(false);
  });

  it("reconstructs recommendations correctly", () => {
    const report = makeReport();
    const parsed = parseReport(serializeReport(report));
    expect(parsed.recommendations.fastest.modelName).toBe("llama3:7b");
    expect(parsed.recommendations.fastest.contextWindow).toBe(32768);
    expect(parsed.recommendations.best_overall.score).toBeCloseTo(0.95);
  });

  it("ignores unknown fields without throwing", () => {
    const report = makeReport();
    const json = serializeReport(report);
    const withExtra = json.replace(
      '"version": "1"',
      '"version": "1",\n  "unknownField": "value"'
    );
    expect(() => parseReport(withExtra)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("serializeReport(parseReport(serializeReport(report))) === serializeReport(report)", () => {
    const report = makeReport();
    const once = serializeReport(report);
    const twice = serializeReport(parseReport(once));
    expect(twice).toBe(once);
  });
});
