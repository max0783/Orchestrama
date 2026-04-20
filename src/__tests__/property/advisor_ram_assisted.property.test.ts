// Feature: benchmark-advisor, Property 29: RAM-assisted model warning display
// Feature: benchmark-advisor, Property 30: RAM-assisted section in report
//
// **Validates: Requirements 10.5, 10.6**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatCandidateList } from "../../advisor/model_filter.js";
import { formatRamAssistedSection } from "../../advisor/report_formatter.js";
import type { BenchmarkRunResult, ModelVramEstimate } from "../../advisor/types.js";

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

// ---------------------------------------------------------------------------
// Property 29: RAM-assisted model warning display
// For any list of RAM-assisted model names, the warning messages should contain
// each model name. Test by checking that formatCandidateList shows ram_assisted
// models with appropriate classification.
// **Validates: Requirements 10.5**
// ---------------------------------------------------------------------------

describe("Property 29: RAM-assisted model warning display", () => {
  it("formatCandidateList shows ram_assisted classification for RAM-assisted models", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            parametersBillions: fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
            quantizationBits: fc.integer({ min: 1, max: 32 }),
            estimatedVramMb: fc.integer({ min: 512, max: 80000 }),
            memoryClass: fc.constant("ram_assisted" as const),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (ramAssistedModels: ModelVramEstimate[]) => {
          const output = formatCandidateList(ramAssistedModels);

          for (const model of ramAssistedModels) {
            // Each RAM-assisted model name must appear in the output
            expect(output).toContain(model.modelName);
            // The ram_assisted classification must appear
            expect(output).toContain("ram_assisted");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatCandidateList marks ram_assisted models as included (not excluded)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            parametersBillions: fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
            quantizationBits: fc.integer({ min: 1, max: 32 }),
            estimatedVramMb: fc.integer({ min: 512, max: 80000 }),
            memoryClass: fc.constant("ram_assisted" as const),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (ramAssistedModels: ModelVramEstimate[]) => {
          const output = formatCandidateList(ramAssistedModels);

          // RAM-assisted models should be marked as included
          expect(output).toContain("✓ included");
          // Should NOT be marked as excluded
          const lines = output.split("\n");
          for (const model of ramAssistedModels) {
            const modelLine = lines.find((l) => l.includes(model.modelName));
            if (modelLine) {
              expect(modelLine).toContain("✓ included");
              expect(modelLine).not.toContain("✗ excluded");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 30: RAM-assisted section in report
// For any RecommendationReport with at least one ram_assisted result in
// allResults, formatRamAssistedSection(results) should contain each
// RAM-assisted model name.
// **Validates: Requirements 10.6**
// ---------------------------------------------------------------------------

describe("Property 30: RAM-assisted section in report", () => {
  it("formatRamAssistedSection contains each RAM-assisted model name", () => {
    fc.assert(
      fc.property(
        fc.array(
          benchmarkRunResultArb.filter((r) => r.memoryMode === "ram_assisted"),
          { minLength: 1, maxLength: 10 }
        ),
        fc.array(
          benchmarkRunResultArb.filter((r) => r.memoryMode === "gpu_native"),
          { minLength: 0, maxLength: 5 }
        ),
        (ramResults, gpuResults) => {
          const allResults = [...ramResults, ...gpuResults];
          const output = formatRamAssistedSection(allResults);

          // Section must be non-empty when there are RAM-assisted results
          expect(output.length).toBeGreaterThan(0);

          // Each RAM-assisted model name must appear
          for (const result of ramResults) {
            expect(output).toContain(result.modelName);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatRamAssistedSection returns empty string when no RAM-assisted results", () => {
    fc.assert(
      fc.property(
        fc.array(
          benchmarkRunResultArb.filter((r) => r.memoryMode === "gpu_native"),
          { minLength: 0, maxLength: 10 }
        ),
        (gpuOnlyResults) => {
          const output = formatRamAssistedSection(gpuOnlyResults);
          expect(output).toBe("");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatRamAssistedSection includes performance metrics for RAM-assisted models", () => {
    fc.assert(
      fc.property(
        fc.array(
          benchmarkRunResultArb.filter((r) => r.memoryMode === "ram_assisted"),
          { minLength: 1, maxLength: 5 }
        ),
        (ramResults) => {
          const output = formatRamAssistedSection(ramResults);

          // Should contain throughput and latency info
          expect(output).toContain("tok/s");
          expect(output).toContain("ms");
          expect(output).toContain("MB");
        }
      ),
      { numRuns: 100 }
    );
  });
});
