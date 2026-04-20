// Feature: benchmark-advisor, Property 5: VRAM-only mode candidate filter
// Feature: benchmark-advisor, Property 6: RAM-assisted mode two-tier filter
// Feature: benchmark-advisor, Property 7: Model candidate display completeness
//
// **Validates: Requirements 2.5, 2.6, 2.7, 2.9, 10.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { classifyModels, formatCandidateList } from "../../advisor/model_filter.js";
import type { ModelVramEstimate } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const modelVramEstimateArb = fc.record({
  modelName: fc.string({ minLength: 1 }),
  parametersBillions: fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
  quantizationBits: fc.integer({ min: 1, max: 32 }),
  estimatedVramMb: fc.integer({ min: 512, max: 80000 }),
  memoryClass: fc.constantFrom("gpu_native" as const, "ram_assisted" as const, "excluded" as const),
});

// ---------------------------------------------------------------------------
// Property 5: VRAM-only mode candidate filter
// Every model with estimatedVramMb > vramBudgetMb should be excluded.
// Every model with estimatedVramMb <= vramBudgetMb should NOT be excluded.
// **Validates: Requirements 2.5, 2.7, 10.2**
// ---------------------------------------------------------------------------

describe("Property 5: VRAM-only mode candidate filter", () => {
  it("in vram_only mode, models exceeding budget are excluded and others are included", () => {
    fc.assert(
      fc.property(
        fc.array(modelVramEstimateArb, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 0, max: 80000 }),
        fc.integer({ min: 1024, max: 131072 }),
        (models, vramBudgetMb, systemRamMb) => {
          const classified = classifyModels(models, vramBudgetMb, systemRamMb, "vram_only");

          for (const model of classified) {
            if (model.estimatedVramMb <= vramBudgetMb) {
              expect(model.memoryClass).not.toBe("excluded");
            } else {
              expect(model.memoryClass).toBe("excluded");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("in vram_only mode, models within budget are classified as gpu_native", () => {
    fc.assert(
      fc.property(
        fc.array(modelVramEstimateArb, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 80000 }),
        fc.integer({ min: 1024, max: 131072 }),
        (models, vramBudgetMb, systemRamMb) => {
          const classified = classifyModels(models, vramBudgetMb, systemRamMb, "vram_only");

          for (const model of classified) {
            if (model.estimatedVramMb <= vramBudgetMb) {
              expect(model.memoryClass).toBe("gpu_native");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: RAM-assisted mode two-tier filter
// Models with estimatedVramMb <= vramBudgetMb + systemRamMb should NOT be excluded.
// Models with estimatedVramMb > vramBudgetMb + systemRamMb should be excluded.
// **Validates: Requirements 2.6, 2.7**
// ---------------------------------------------------------------------------

describe("Property 6: RAM-assisted mode two-tier filter", () => {
  it("in ram_assisted mode, models within combined budget are not excluded", () => {
    fc.assert(
      fc.property(
        fc.array(modelVramEstimateArb, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 0, max: 40000 }),
        fc.integer({ min: 1024, max: 131072 }),
        (models, vramBudgetMb, systemRamMb) => {
          const classified = classifyModels(models, vramBudgetMb, systemRamMb, "ram_assisted");
          const combinedBudget = vramBudgetMb + systemRamMb;

          for (const model of classified) {
            if (model.estimatedVramMb <= combinedBudget) {
              expect(model.memoryClass).not.toBe("excluded");
            } else {
              expect(model.memoryClass).toBe("excluded");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("in ram_assisted mode, models within VRAM budget are gpu_native, between budgets are ram_assisted", () => {
    fc.assert(
      fc.property(
        fc.array(modelVramEstimateArb, { minLength: 0, maxLength: 20 }),
        fc.integer({ min: 0, max: 40000 }),
        fc.integer({ min: 1024, max: 131072 }),
        (models, vramBudgetMb, systemRamMb) => {
          const classified = classifyModels(models, vramBudgetMb, systemRamMb, "ram_assisted");
          const combinedBudget = vramBudgetMb + systemRamMb;

          for (const model of classified) {
            if (model.estimatedVramMb <= vramBudgetMb) {
              expect(model.memoryClass).toBe("gpu_native");
            } else if (model.estimatedVramMb <= combinedBudget) {
              expect(model.memoryClass).toBe("ram_assisted");
            } else {
              expect(model.memoryClass).toBe("excluded");
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Model candidate display completeness
// formatCandidateList(models) should contain each model's name, VRAM estimate,
// and memoryClass.
// **Validates: Requirements 2.9**
// ---------------------------------------------------------------------------

describe("Property 7: Model candidate display completeness", () => {
  it("formatCandidateList contains each model name, VRAM estimate, and memoryClass", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            parametersBillions: fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
            quantizationBits: fc.integer({ min: 1, max: 32 }),
            estimatedVramMb: fc.integer({ min: 512, max: 80000 }),
            memoryClass: fc.constantFrom(
              "gpu_native" as const,
              "ram_assisted" as const,
              "excluded" as const
            ),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (models: ModelVramEstimate[]) => {
          const output = formatCandidateList(models);

          for (const model of models) {
            // Model name must appear
            expect(output).toContain(model.modelName);
            // VRAM estimate must appear (rounded)
            expect(output).toContain(String(Math.round(model.estimatedVramMb)));
            // Memory class must appear
            expect(output).toContain(model.memoryClass);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatCandidateList returns (no models) for empty input", () => {
    fc.assert(
      fc.property(fc.constant([]), (models: ModelVramEstimate[]) => {
        const output = formatCandidateList(models);
        expect(output).toBe("(no models)");
      }),
      { numRuns: 1 }
    );
  });
});
