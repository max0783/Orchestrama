// Feature: benchmark-advisor, Property 1: VRAM budget safety margin
// Feature: benchmark-advisor, Property 2: Multi-GPU VRAM summation
// Feature: benchmark-advisor, Property 4: VRAM estimation formula
//
// **Validates: Requirements 1.5, 1.3, 2.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { estimateModelVram } from "../../advisor/model_filter.js";
import { detectHardware } from "../../advisor/gpu_detector.js";

// ---------------------------------------------------------------------------
// Property 1: VRAM budget safety margin
// For any totalVramMb and safetyMarginPct, the computed vramBudgetMb should
// equal Math.round(totalVramMb * (1 - safetyMarginPct / 100)).
// **Validates: Requirements 1.5**
// ---------------------------------------------------------------------------

describe("Property 1: VRAM budget safety margin", () => {
  it("vramBudgetMb equals Math.round(totalVramMb * (1 - safetyMarginPct / 100))", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100 }),
        (totalVramMb, safetyMarginPct) => {
          const expected = Math.round(totalVramMb * (1 - safetyMarginPct / 100));
          const actual = Math.round(totalVramMb * (1 - safetyMarginPct / 100));
          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("detectHardware computes vramBudgetMb correctly from safetyMarginPct", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 1024, max: 32768 }),
        async (safetyMarginPct, vramMb) => {
          const execCommand = async (cmd: string): Promise<string> => {
            if (cmd.includes("nvidia-smi")) {
              return `Test GPU, ${vramMb}\n`;
            }
            if (cmd.includes("sysctl hw.memsize")) {
              return `hw.memsize: ${8 * 1024 * 1024 * 1024}\n`;
            }
            throw new Error("unknown command");
          };

          const hw = await detectHardware({
            safetyMarginPct,
            execCommand,
          });

          const expectedBudget = Math.round(vramMb * (1 - safetyMarginPct / 100));
          expect(hw.vramBudgetMb).toBe(expectedBudget);
          expect(hw.safetyMarginPct).toBe(safetyMarginPct);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Multi-GPU VRAM summation
// For any list of per-GPU VRAM values, the total should equal the sum.
// **Validates: Requirements 1.3**
// ---------------------------------------------------------------------------

describe("Property 2: Multi-GPU VRAM summation", () => {
  it("totalVramMb equals the sum of all per-GPU VRAM values", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1024, max: 24576 }), { minLength: 1, maxLength: 8 }),
        async (gpuVrams) => {
          const nvidiaOutput = gpuVrams
            .map((v, i) => `GPU ${i}, ${v}`)
            .join("\n");

          const execCommand = async (cmd: string): Promise<string> => {
            if (cmd.includes("nvidia-smi")) {
              return nvidiaOutput + "\n";
            }
            if (cmd.includes("sysctl hw.memsize")) {
              return `hw.memsize: ${8 * 1024 * 1024 * 1024}\n`;
            }
            throw new Error("unknown command");
          };

          const hw = await detectHardware({ execCommand });

          const expectedTotal = gpuVrams.reduce((sum, v) => sum + v, 0);
          expect(hw.totalVramMb).toBe(expectedTotal);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: VRAM estimation formula
// For any paramB and quantBits, estimateModelVram(paramB, quantBits) should
// equal paramB * (quantBits / 8) * 1024 + 512.
// **Validates: Requirements 2.4**
// ---------------------------------------------------------------------------

describe("Property 4: VRAM estimation formula", () => {
  it("estimateModelVram(paramB, quantBits) equals paramB * (quantBits / 8) * 1024 + 512", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
        fc.integer({ min: 1, max: 32 }),
        (paramB, quantBits) => {
          const result = estimateModelVram(paramB, quantBits);
          const expected = paramB * (quantBits / 8) * 1024 + 512;
          expect(result).toBeCloseTo(expected, 5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("estimateModelVram respects custom overheadMb", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.1), max: Math.fround(200), noNaN: true }),
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 0, max: 4096 }),
        (paramB, quantBits, overheadMb) => {
          const result = estimateModelVram(paramB, quantBits, overheadMb);
          const expected = paramB * (quantBits / 8) * 1024 + overheadMb;
          expect(result).toBeCloseTo(expected, 5);
        }
      ),
      { numRuns: 100 }
    );
  });
});
