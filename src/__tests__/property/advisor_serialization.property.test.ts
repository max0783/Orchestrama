// Feature: benchmark-advisor, Property 27: RecommendationReport serialisation round-trip
// Feature: benchmark-advisor, Property 28: Unknown field tolerance
//
// **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { serializeReport, parseReport } from "../../advisor/serialization.js";
import { generateRecommendations } from "../../advisor/recommendation_engine.js";
import type { BenchmarkRunResult, HardwareInfo } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const benchmarkRunResultArb: fc.Arbitrary<BenchmarkRunResult> = fc.record({
  modelName: fc.string({ minLength: 1 }),
  contextWindow: fc.constantFrom(4096, 8192, 16384, 32768, 65536, 131072),
  throughputTokensPerSec: fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
  latencyMs: fc.float({ min: Math.fround(1), max: Math.fround(10000), noNaN: true }),
  vramEstimateMb: fc.integer({ min: 512, max: 80000 }),
  flashAttentionEnabled: fc.boolean(),
  memoryMode: fc.constantFrom("gpu_native" as const, "ram_assisted" as const),
  parametersBillions: fc.integer({ min: 0, max: 100 }),
});

const hardwareInfoArb: fc.Arbitrary<HardwareInfo> = fc.record({
  gpuName: fc.string({ minLength: 1 }),
  totalVramMb: fc.integer({ min: 0, max: 100000 }),
  safetyMarginPct: fc.integer({ min: 0, max: 50 }),
  vramBudgetMb: fc.integer({ min: 0, max: 100000 }),
  systemRamMb: fc.integer({ min: 1024, max: 131072 }),
  cpuOnly: fc.boolean(),
});

// Arbitrary for a complete RecommendationReport (built via generateRecommendations)
const reportArb = fc
  .tuple(
    fc.array(benchmarkRunResultArb, { minLength: 1, maxLength: 10 }),
    hardwareInfoArb,
    fc.constantFrom("vram_only" as const, "ram_assisted" as const),
    fc.array(
      fc.record({
        modelName: fc.string({ minLength: 1 }),
        reason: fc.string({ minLength: 1 }),
      }),
      { minLength: 0, maxLength: 5 }
    )
  )
  .map(([results, hardware, memoryMode, exclusions]) =>
    generateRecommendations(results, hardware, memoryMode, exclusions)
  );

// ---------------------------------------------------------------------------
// Property 27: RecommendationReport serialisation round-trip
// serializeReport(parseReport(serializeReport(r))) === serializeReport(r)
// **Validates: Requirements 9.1, 9.2, 9.3**
// ---------------------------------------------------------------------------

describe("Property 27: RecommendationReport serialisation round-trip", () => {
  it("double round-trip produces identical JSON", () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const json1 = serializeReport(report);
        const parsed = parseReport(json1);
        const json2 = serializeReport(parsed);

        expect(json2).toBe(json1);
      }),
      { numRuns: 100 }
    );
  });

  it("parseReport reconstructs all known fields correctly", () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const json = serializeReport(report);
        const parsed = parseReport(json);

        // Hardware fields
        expect(parsed.hardware.gpuName).toBe(report.hardware.gpuName);
        expect(parsed.hardware.totalVramMb).toBe(report.hardware.totalVramMb);
        expect(parsed.hardware.safetyMarginPct).toBe(report.hardware.safetyMarginPct);
        expect(parsed.hardware.vramBudgetMb).toBe(report.hardware.vramBudgetMb);
        expect(parsed.hardware.systemRamMb).toBe(report.hardware.systemRamMb);
        expect(parsed.hardware.cpuOnly).toBe(report.hardware.cpuOnly);

        // Memory mode
        expect(parsed.memoryMode).toBe(report.memoryMode);

        // Recommendations
        const cats = ["fastest", "most_context", "fa", "best_overall"] as const;
        for (const cat of cats) {
          const orig = report.recommendations[cat];
          const rec = parsed.recommendations[cat];
          expect(rec.modelName).toBe(orig.modelName);
          expect(rec.contextWindow).toBe(orig.contextWindow);
          expect(rec.throughputTokensPerSec).toBeCloseTo(orig.throughputTokensPerSec, 5);
          expect(rec.latencyMs).toBeCloseTo(orig.latencyMs, 5);
          expect(rec.vramEstimateMb).toBe(orig.vramEstimateMb);
          expect(rec.flashAttentionEnabled).toBe(orig.flashAttentionEnabled);
          expect(rec.memoryMode).toBe(orig.memoryMode);
        }

        // Exclusions
        expect(parsed.exclusions.length).toBe(report.exclusions.length);

        // All results
        expect(parsed.allResults.length).toBe(report.allResults.length);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 28: Unknown field tolerance
// For any valid serialised report with extra unknown fields injected,
// parseReport should succeed and produce a report with identical known field values.
// **Validates: Requirements 9.4**
// ---------------------------------------------------------------------------

describe("Property 28: Unknown field tolerance", () => {
  it("parseReport ignores unknown fields and preserves known field values", () => {
    fc.assert(
      fc.property(
        reportArb,
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0 && s !== "version"),
        fc.string({ minLength: 1 }),
        (report, unknownKey, unknownValue) => {
          const json = serializeReport(report);
          const parsed1 = parseReport(json);

          // Inject unknown fields at the top level
          const rawObj = JSON.parse(json) as Record<string, unknown>;
          rawObj[unknownKey] = unknownValue;
          rawObj["__unknown_nested__"] = { foo: "bar", baz: 42 };

          const jsonWithExtras = JSON.stringify(rawObj, null, 2);

          // Should not throw
          const parsed2 = parseReport(jsonWithExtras);

          // Known fields should be identical
          expect(parsed2.hardware.gpuName).toBe(parsed1.hardware.gpuName);
          expect(parsed2.hardware.totalVramMb).toBe(parsed1.hardware.totalVramMb);
          expect(parsed2.memoryMode).toBe(parsed1.memoryMode);
          expect(parsed2.allResults.length).toBe(parsed1.allResults.length);
          expect(parsed2.exclusions.length).toBe(parsed1.exclusions.length);

          const cats = ["fastest", "most_context", "fa", "best_overall"] as const;
          for (const cat of cats) {
            expect(parsed2.recommendations[cat].modelName).toBe(
              parsed1.recommendations[cat].modelName
            );
            expect(parsed2.recommendations[cat].contextWindow).toBe(
              parsed1.recommendations[cat].contextWindow
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("parseReport ignores unknown fields injected into hardware object", () => {
    fc.assert(
      fc.property(reportArb, (report) => {
        const json = serializeReport(report);
        const rawObj = JSON.parse(json) as Record<string, unknown>;

        // Inject unknown fields into hardware
        const hw = rawObj["hardware"] as Record<string, unknown>;
        hw["unknownHardwareField"] = "some value";
        hw["anotherField"] = 12345;

        const jsonWithExtras = JSON.stringify(rawObj, null, 2);
        const parsed = parseReport(jsonWithExtras);

        expect(parsed.hardware.gpuName).toBe(report.hardware.gpuName);
        expect(parsed.hardware.totalVramMb).toBe(report.hardware.totalVramMb);
      }),
      { numRuns: 100 }
    );
  });
});
