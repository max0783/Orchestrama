// Feature: benchmark-advisor, Property 8: Context VRAM estimation formula
// Feature: benchmark-advisor, Property 9: Context window safety filter
// Feature: benchmark-advisor, Property 10: Maximum safe context window display
//
// **Validates: Requirements 3.1, 3.2, 3.4, 3.5**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  estimateContextVramMb,
  findSafeContextWindows,
  formatContextWindowSummary,
  CONTEXT_WINDOW_SIZES,
} from "../../advisor/context_checker.js";
import type { ContextWindowResult } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// Property 8: Context VRAM estimation formula
// For any contextTokens and bytesPerToken,
// estimateContextVramMb(contextTokens, bytesPerToken) should equal
// contextTokens * bytesPerToken / (1024 * 1024).
// **Validates: Requirements 3.1**
// ---------------------------------------------------------------------------

describe("Property 8: Context VRAM estimation formula", () => {
  it("estimateContextVramMb equals contextTokens * bytesPerToken / (1024 * 1024)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200000 }),
        fc.integer({ min: 1, max: 4 }),
        (contextTokens, bytesPerToken) => {
          const result = estimateContextVramMb(contextTokens, bytesPerToken);
          const expected = (contextTokens * bytesPerToken) / (1024 * 1024);
          expect(result).toBeCloseTo(expected, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("estimateContextVramMb uses default bytesPerToken of 2", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200000 }), (contextTokens) => {
        const result = estimateContextVramMb(contextTokens);
        const expected = (contextTokens * 2) / (1024 * 1024);
        expect(result).toBeCloseTo(expected, 10);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Context window safety filter
// Every size in safeContextSizes should satisfy
// modelVramMb + estimateContextVramMb(size) <= vramBudgetMb.
// Every size NOT in safeContextSizes should NOT satisfy that condition.
// **Validates: Requirements 3.2, 3.4**
// ---------------------------------------------------------------------------

describe("Property 9: Context window safety filter", () => {
  it("every safe context size satisfies modelVramMb + contextVram <= vramBudgetMb", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 80000 }),
        fc.integer({ min: 0, max: 100000 }),
        (modelVramMb, vramBudgetMb) => {
          const result = findSafeContextWindows(modelVramMb, vramBudgetMb);

          for (const size of result.safeContextSizes) {
            const contextVram = estimateContextVramMb(size);
            expect(modelVramMb + contextVram).toBeLessThanOrEqual(vramBudgetMb);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every unsafe context size does NOT satisfy modelVramMb + contextVram <= vramBudgetMb", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 80000 }),
        fc.integer({ min: 0, max: 100000 }),
        (modelVramMb, vramBudgetMb) => {
          const result = findSafeContextWindows(modelVramMb, vramBudgetMb);
          const safeSet = new Set(result.safeContextSizes);

          for (const size of CONTEXT_WINDOW_SIZES) {
            if (!safeSet.has(size)) {
              const contextVram = estimateContextVramMb(size);
              expect(modelVramMb + contextVram).toBeGreaterThan(vramBudgetMb);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Maximum safe context window display
// For any list of ContextWindowResult objects with non-null maxSafeContextTokens,
// formatContextWindowSummary(results) should contain the max value for each model.
// **Validates: Requirements 3.5**
// ---------------------------------------------------------------------------

describe("Property 10: Maximum safe context window display", () => {
  it("formatContextWindowSummary contains the maxSafeContextTokens for each model", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            maxSafeContextTokens: fc.integer({ min: 4096, max: 131072 }),
            safeContextSizes: fc.constant([4096]),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (results: ContextWindowResult[]) => {
          const output = formatContextWindowSummary(results);

          for (const result of results) {
            expect(output).toContain(result.modelName);
            if (result.maxSafeContextTokens !== null) {
              // The number appears formatted (with locale separators or plain)
              const numStr = result.maxSafeContextTokens.toLocaleString();
              expect(output).toContain(numStr);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatContextWindowSummary shows 'none' for models with no safe context window", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            modelName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            maxSafeContextTokens: fc.constant(null),
            safeContextSizes: fc.constant([]),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (results: ContextWindowResult[]) => {
          const output = formatContextWindowSummary(results);
          expect(output).toContain("none");
        }
      ),
      { numRuns: 100 }
    );
  });
});
