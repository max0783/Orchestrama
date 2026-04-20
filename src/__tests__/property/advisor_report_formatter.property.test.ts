// Feature: benchmark-advisor, Property 3: Hardware info display completeness
// Feature: benchmark-advisor, Property 19: RecommendationReport table completeness
// Feature: benchmark-advisor, Property 20: Hardware summary completeness
// Feature: benchmark-advisor, Property 21: Exclusion summary completeness
// Feature: benchmark-advisor, Property 22: Best Overall highlighting
//
// **Validates: Requirements 1.8, 6.1, 6.2, 6.3, 6.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  formatHardwareSummary,
  formatRecommendationTable,
  formatExclusionSummary,
  formatRecommendationReport,
} from "../../advisor/report_formatter.js";
import { generateRecommendations } from "../../advisor/recommendation_engine.js";
import type { BenchmarkRunResult, HardwareInfo } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const hardwareInfoArb: fc.Arbitrary<HardwareInfo> = fc.record({
  gpuName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  totalVramMb: fc.integer({ min: 0, max: 100000 }),
  safetyMarginPct: fc.integer({ min: 0, max: 50 }),
  vramBudgetMb: fc.integer({ min: 0, max: 100000 }),
  systemRamMb: fc.integer({ min: 1024, max: 131072 }),
  cpuOnly: fc.boolean(),
});

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

// ---------------------------------------------------------------------------
// Property 3: Hardware info display completeness
// For any HardwareInfo, formatHardwareSummary should contain gpuName,
// totalVramMb, safetyMarginPct, vramBudgetMb, systemRamMb.
// **Validates: Requirements 1.8**
// ---------------------------------------------------------------------------

describe("Property 3: Hardware info display completeness", () => {
  it("formatHardwareSummary contains gpuName, totalVramMb, safetyMarginPct, vramBudgetMb, systemRamMb", () => {
    fc.assert(
      fc.property(
        hardwareInfoArb,
        fc.constantFrom("vram_only" as const, "ram_assisted" as const),
        (hardware, mode) => {
          const output = formatHardwareSummary(hardware, mode);

          expect(output).toContain(hardware.gpuName);
          expect(output).toContain(String(hardware.safetyMarginPct));
          // Numbers may be formatted with locale separators
          expect(output).toContain(hardware.totalVramMb.toLocaleString("en-US"));
          expect(output).toContain(hardware.vramBudgetMb.toLocaleString("en-US"));
          expect(output).toContain(hardware.systemRamMb.toLocaleString("en-US"));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19: RecommendationReport table completeness
// For any RecommendationReport, formatRecommendationTable should contain all
// 8 column headers.
// **Validates: Requirements 6.1**
// ---------------------------------------------------------------------------

describe("Property 19: RecommendationReport table completeness", () => {
  it("formatRecommendationTable contains all 8 column headers", () => {
    fc.assert(
      fc.property(
        fc.array(benchmarkRunResultArb, { minLength: 1, maxLength: 10 }),
        hardwareInfoArb,
        fc.constantFrom("vram_only" as const, "ram_assisted" as const),
        (results, hardware, memoryMode) => {
          const report = generateRecommendations(results, hardware, memoryMode, []);
          const output = formatRecommendationTable(report.recommendations);

          const expectedHeaders = [
            "Category",
            "Model",
            "Context Window",
            "Throughput",
            "Latency",
            "VRAM",
            "FA",
            "Memory Mode",
          ];

          for (const header of expectedHeaders) {
            expect(output).toContain(header);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 20: Hardware summary completeness
// For any HardwareInfo and memory mode, the hardware summary should contain
// GPU name, total VRAM, VRAM budget, safety margin, system RAM, and memory mode.
// **Validates: Requirements 6.2**
// ---------------------------------------------------------------------------

describe("Property 20: Hardware summary completeness", () => {
  it("formatHardwareSummary contains GPU name, VRAM values, safety margin, system RAM, and memory mode", () => {
    fc.assert(
      fc.property(
        hardwareInfoArb,
        fc.constantFrom("vram_only" as const, "ram_assisted" as const),
        (hardware, mode) => {
          const output = formatHardwareSummary(hardware, mode);

          expect(output).toContain(hardware.gpuName);
          expect(output).toContain(hardware.totalVramMb.toLocaleString("en-US"));
          expect(output).toContain(hardware.vramBudgetMb.toLocaleString("en-US"));
          expect(output).toContain(String(hardware.safetyMarginPct));
          expect(output).toContain(hardware.systemRamMb.toLocaleString("en-US"));

          // Memory mode label must appear
          if (mode === "vram_only") {
            expect(output).toContain("VRAM-only");
          } else {
            expect(output).toContain("RAM-assisted");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: Exclusion summary completeness
// For any list of exclusions, formatExclusionSummary should contain each
// model name and reason.
// **Validates: Requirements 6.3**
// ---------------------------------------------------------------------------

describe("Property 21: Exclusion summary completeness", () => {
  it("formatExclusionSummary contains each excluded model name and reason", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            reason: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (exclusions) => {
          const output = formatExclusionSummary(exclusions);

          for (const { modelName, reason } of exclusions) {
            expect(output).toContain(modelName);
            expect(output).toContain(reason);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatExclusionSummary shows (none) for empty exclusions", () => {
    fc.assert(
      fc.property(fc.constant([]), (exclusions) => {
        const output = formatExclusionSummary(exclusions);
        expect(output).toContain("(none)");
      }),
      { numRuns: 1 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22: Best Overall highlighting
// For any RecommendationReport, formatRecommendationReport should contain "★".
// **Validates: Requirements 6.4**
// ---------------------------------------------------------------------------

describe("Property 22: Best Overall highlighting", () => {
  it("formatRecommendationReport contains ★ to highlight Best Overall", () => {
    fc.assert(
      fc.property(
        fc.array(benchmarkRunResultArb, { minLength: 1, maxLength: 10 }),
        hardwareInfoArb,
        fc.constantFrom("vram_only" as const, "ram_assisted" as const),
        (results, hardware, memoryMode) => {
          const report = generateRecommendations(results, hardware, memoryMode, []);
          const output = formatRecommendationReport(report);

          expect(output).toContain("★");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatRecommendationTable contains ★ in the Best Overall row", () => {
    fc.assert(
      fc.property(
        fc.array(benchmarkRunResultArb, { minLength: 1, maxLength: 10 }),
        hardwareInfoArb,
        fc.constantFrom("vram_only" as const, "ram_assisted" as const),
        (results, hardware, memoryMode) => {
          const report = generateRecommendations(results, hardware, memoryMode, []);
          const tableOutput = formatRecommendationTable(report.recommendations);

          expect(tableOutput).toContain("★");
          expect(tableOutput).toContain("Best Overall");
        }
      ),
      { numRuns: 100 }
    );
  });
});
