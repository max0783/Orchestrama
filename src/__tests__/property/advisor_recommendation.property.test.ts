// Feature: benchmark-advisor, Properties 12-18: Recommendation engine properties
//
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  generateRecommendations,
  selectFastest,
  selectMostContext,
  selectBestFa,
  computeBestOverall,
} from "../../advisor/recommendation_engine.js";
import type { BenchmarkRunResult, HardwareInfo } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const benchmarkRunResultArb = fc.record({
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

// Non-empty array of results with at least one unique model name
const nonEmptyResultsArb = fc.array(benchmarkRunResultArb, { minLength: 1, maxLength: 20 });

// ---------------------------------------------------------------------------
// Property 12: Recommendation completeness
// For any non-empty list of BenchmarkRunResults, generateRecommendations should
// return a report with all 4 categories.
// **Validates: Requirements 5.1**
// ---------------------------------------------------------------------------

describe("Property 12: Recommendation completeness", () => {
  it("generateRecommendations returns all 4 categories for any non-empty results", () => {
    fc.assert(
      fc.property(
        nonEmptyResultsArb,
        hardwareInfoArb,
        fc.constantFrom("vram_only" as const, "ram_assisted" as const),
        (results, hardware, memoryMode) => {
          const report = generateRecommendations(results, hardware, memoryMode, []);

          expect(report.recommendations).toHaveProperty("fastest");
          expect(report.recommendations).toHaveProperty("most_context");
          expect(report.recommendations).toHaveProperty("fa");
          expect(report.recommendations).toHaveProperty("best_overall");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Fastest recommendation correctness
// For any list of results with distinct throughput values, the fastest
// recommendation should have the highest throughput.
// **Validates: Requirements 5.2**
// ---------------------------------------------------------------------------

describe("Property 13: Fastest recommendation correctness", () => {
  it("fastest recommendation has the highest throughput among the considered pool (FA-preferred)", () => {
    fc.assert(
      fc.property(nonEmptyResultsArb, (results) => {
        const fastest = selectFastest(results);

        // selectFastest prefers FA-enabled results; falls back to all results if none
        const faResults = results.filter((r) => r.flashAttentionEnabled);
        const pool = faResults.length > 0 ? faResults : results;

        const maxThroughputInPool = Math.max(...pool.map((r) => r.throughputTokensPerSec));

        // The fastest recommendation's throughput should equal the max in the pool
        expect(fastest.throughputTokensPerSec).toBe(maxThroughputInPool);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Most Context recommendation correctness
// For any list of results, the most_context recommendation should have the
// largest context window.
// **Validates: Requirements 5.3**
// ---------------------------------------------------------------------------

describe("Property 14: Most Context recommendation correctness", () => {
  it("most_context recommendation has the largest context window among all results", () => {
    fc.assert(
      fc.property(nonEmptyResultsArb, (results) => {
        const mostContext = selectMostContext(results);
        const maxContext = Math.max(...results.map((r) => r.contextWindow));

        expect(mostContext.contextWindow).toBe(maxContext);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: FA recommendation correctness
// For any list of results with both FA-on and FA-off runs for the same models,
// the FA recommendation should be the model with the greatest throughput improvement.
// **Validates: Requirements 5.4**
// ---------------------------------------------------------------------------

describe("Property 15: FA recommendation correctness", () => {
  it("FA recommendation is the model with the greatest FA improvement when both FA-on and FA-off exist", () => {
    fc.assert(
      fc.property(
        // Generate results with explicit FA-on and FA-off pairs
        fc.array(
          fc.record({
            modelName: fc.constantFrom("model-a", "model-b", "model-c"),
            contextWindow: fc.constantFrom(4096, 8192, 16384),
            throughputTokensPerSec: fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
            latencyMs: fc.float({ min: Math.fround(1), max: Math.fround(10000), noNaN: true }),
            vramEstimateMb: fc.integer({ min: 512, max: 80000 }),
            flashAttentionEnabled: fc.boolean(),
            memoryMode: fc.constantFrom("gpu_native" as const, "ram_assisted" as const),
            parametersBillions: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 2, maxLength: 20 }
        ),
        (results) => {
          const faRec = selectBestFa(results);

          // The FA recommendation must be one of the model names in results
          const modelNames = new Set(results.map((r) => r.modelName));
          expect(modelNames.has(faRec.modelName)).toBe(true);

          // If there are models with both FA-on and FA-off, verify the improvement
          const modelsWithBoth = [...modelNames].filter((name) => {
            const modelResults = results.filter((r) => r.modelName === name);
            const hasFa = modelResults.some((r) => r.flashAttentionEnabled);
            const hasNoFa = modelResults.some((r) => !r.flashAttentionEnabled);
            return hasFa && hasNoFa;
          });

          if (modelsWithBoth.length > 0) {
            // Compute improvements for each model with both
            const improvements = modelsWithBoth.map((name) => {
              const modelResults = results.filter((r) => r.modelName === name);
              const maxFa = Math.max(
                ...modelResults
                  .filter((r) => r.flashAttentionEnabled)
                  .map((r) => r.throughputTokensPerSec)
              );
              const maxNoFa = Math.max(
                ...modelResults
                  .filter((r) => !r.flashAttentionEnabled)
                  .map((r) => r.throughputTokensPerSec)
              );
              return { name, improvement: maxFa - maxNoFa };
            });

            const maxImprovement = Math.max(...improvements.map((i) => i.improvement));
            const bestModel = improvements.find((i) => i.improvement === maxImprovement)!;

            expect(faRec.modelName).toBe(bestModel.name);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Best Overall weighted score
// For any list of results, the best_overall recommendation should have a score
// field that is a number.
// **Validates: Requirements 5.5**
// ---------------------------------------------------------------------------

describe("Property 16: Best Overall weighted score", () => {
  it("best_overall recommendation has a numeric score field", () => {
    fc.assert(
      fc.property(nonEmptyResultsArb, (results) => {
        const bestOverall = computeBestOverall(results);

        expect(bestOverall.score).toBeDefined();
        expect(typeof bestOverall.score).toBe("number");
        expect(isNaN(bestOverall.score!)).toBe(false);
        expect(bestOverall.score!).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("best_overall score is between 0 and 1 (weighted rank formula)", () => {
    fc.assert(
      fc.property(nonEmptyResultsArb, (results) => {
        const bestOverall = computeBestOverall(results);

        // Score = 0.5*(1/tRank) + 0.3*(1/cRank) + 0.2*(1/fRank)
        // Maximum possible score is 0.5 + 0.3 + 0.2 = 1.0 (when all ranks are 1)
        expect(bestOverall.score!).toBeGreaterThan(0);
        expect(bestOverall.score!).toBeLessThanOrEqual(1.0 + 1e-9);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: Tie-breaking by VRAM
// For any two models with identical throughput, the fastest recommendation
// should select the one with lower VRAM.
// **Validates: Requirements 5.6**
// ---------------------------------------------------------------------------

describe("Property 17: Tie-breaking by VRAM", () => {
  it("when two models have identical throughput, the one with lower VRAM is selected as fastest", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
        fc.integer({ min: 512, max: 40000 }),
        fc.integer({ min: 512, max: 40000 }),
        (throughput, vram1, vram2) => {
          fc.pre(vram1 !== vram2);

          const results: BenchmarkRunResult[] = [
            {
              modelName: "model-a",
              contextWindow: 4096,
              throughputTokensPerSec: throughput,
              latencyMs: 100,
              vramEstimateMb: vram1,
              flashAttentionEnabled: false,
              memoryMode: "gpu_native",
              parametersBillions: 7,
            },
            {
              modelName: "model-b",
              contextWindow: 4096,
              throughputTokensPerSec: throughput,
              latencyMs: 100,
              vramEstimateMb: vram2,
              flashAttentionEnabled: false,
              memoryMode: "gpu_native",
              parametersBillions: 7,
            },
          ];

          const fastest = selectFastest(results);
          const expectedModel = vram1 < vram2 ? "model-a" : "model-b";
          expect(fastest.modelName).toBe(expectedModel);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Recommendation field completeness
// For any recommendation, it should have all required fields.
// **Validates: Requirements 5.7, 5.8**
// ---------------------------------------------------------------------------

describe("Property 18: Recommendation field completeness", () => {
  it("every recommendation has all required fields", () => {
    fc.assert(
      fc.property(
        nonEmptyResultsArb,
        hardwareInfoArb,
        fc.constantFrom("vram_only" as const, "ram_assisted" as const),
        (results, hardware, memoryMode) => {
          const report = generateRecommendations(results, hardware, memoryMode, []);

          const categories = ["fastest", "most_context", "fa", "best_overall"] as const;
          for (const cat of categories) {
            const rec = report.recommendations[cat];

            expect(typeof rec.modelName).toBe("string");
            expect(rec.modelName.length).toBeGreaterThan(0);
            expect(typeof rec.contextWindow).toBe("number");
            expect(typeof rec.throughputTokensPerSec).toBe("number");
            expect(typeof rec.latencyMs).toBe("number");
            expect(typeof rec.vramEstimateMb).toBe("number");
            expect(typeof rec.flashAttentionEnabled).toBe("boolean");
            expect(["gpu_native", "ram_assisted"]).toContain(rec.memoryMode);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
