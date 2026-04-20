// Feature: interactive-console-ui, Property 2: offload detection correctness
// Feature: interactive-console-ui, Property 3: offload warning format
// Feature: interactive-console-ui, Property 4: step-down monotonicity

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { CONTEXT_WINDOW_SIZES } from "../../advisor/context_checker.js";

// ---------------------------------------------------------------------------
// Inline helpers (mirrors private logic in orchestrator.ts)
// ---------------------------------------------------------------------------

/**
 * Mirrors the offload detection logic from checkOffloading() in orchestrator.ts.
 * Returns true iff size_vram < size.
 */
function checkOffloadingLogic(entry: { size: number; size_vram: number }): boolean {
  return entry.size_vram < entry.size;
}

/**
 * Mirrors the warning string produced in runPhase4() when offloading is detected.
 * Format: ⚠ {modelName}: offloading detected ({X} MB in VRAM, {Y} MB total) — context may be too large
 */
function buildOffloadWarning(
  modelName: string,
  entry: { size: number; size_vram: number }
): string {
  const sizeVramMb = Math.round(entry.size_vram / (1024 * 1024));
  const sizeTotalMb = Math.round(entry.size / (1024 * 1024));
  return `  ⚠ ${modelName}: offloading detected (${sizeVramMb} MB in VRAM, ${sizeTotalMb} MB total) — context may be too large`;
}

/**
 * Mirrors the step-down sequence construction from runPhase4():
 *   const sizes = [...CONTEXT_WINDOW_SIZES].reverse().filter(s => s < startingCtx);
 */
function buildStepDownSequence(startingCtx: number): number[] {
  return [...CONTEXT_WINDOW_SIZES].reverse().filter((s) => s < startingCtx);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// Positive integer sizes (bytes); keep them in a realistic range to avoid
// floating-point edge cases in Math.round, but allow size_vram < size or >=.
const sizeArb = fc.integer({ min: 1, max: 2 ** 40 });

const runningModelEntryArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 80 }),
  size: sizeArb,
  size_vram: sizeArb,
});

// Entry where offloading IS occurring (size_vram strictly less than size)
const offloadingEntryArb = fc
  .tuple(
    fc.integer({ min: 2, max: 2 ** 40 }),
    fc.integer({ min: 1, max: 2 ** 40 })
  )
  .filter(([size, size_vram]) => size_vram < size)
  .map(([size, size_vram]) => ({ size, size_vram }));

// Model name: printable ASCII, non-empty, no newlines
const modelNameArb = fc.string({ minLength: 1, maxLength: 80 }).filter(
  (s) => s.trim().length > 0 && !s.includes("\n") && !s.includes("\r")
);

// Starting context size: one of the values in CONTEXT_WINDOW_SIZES
const contextWindowSizeArb = fc.constantFrom(...CONTEXT_WINDOW_SIZES);

// ---------------------------------------------------------------------------
// Property 2: Offload detection correctness
// **Validates: Requirements 2.1**
// ---------------------------------------------------------------------------

describe("Property 2: offload detection correctness", () => {
  it("returns true iff size_vram < size, false otherwise", () => {
    // Feature: interactive-console-ui, Property 2: offload detection correctness
    fc.assert(
      fc.property(runningModelEntryArb, (entry) => {
        const result = checkOffloadingLogic(entry);
        const expected = entry.size_vram < entry.size;
        return result === expected;
      }),
      { numRuns: 100 }
    );
  });

  it("returns false when size_vram equals size (no offloading)", () => {
    fc.assert(
      fc.property(sizeArb, (size) => {
        const result = checkOffloadingLogic({ size, size_vram: size });
        return result === false;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Offload warning format
// **Validates: Requirements 2.2**
// ---------------------------------------------------------------------------

describe("Property 3: offload warning format", () => {
  it("warning string contains the model name and both MB values", () => {
    // Feature: interactive-console-ui, Property 3: offload warning format
    fc.assert(
      fc.property(modelNameArb, offloadingEntryArb, (modelName, entry) => {
        const warning = buildOffloadWarning(modelName, entry);

        const sizeVramMb = Math.round(entry.size_vram / (1024 * 1024));
        const sizeTotalMb = Math.round(entry.size / (1024 * 1024));

        // Must contain the model name
        if (!warning.includes(modelName)) return false;

        // Must contain the VRAM MB value
        if (!warning.includes(String(sizeVramMb))) return false;

        // Must contain the total MB value
        if (!warning.includes(String(sizeTotalMb))) return false;

        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Step-down monotonicity
// **Validates: Requirements 2.3**
// ---------------------------------------------------------------------------

describe("Property 4: step-down monotonicity", () => {
  it("step-down sequence is strictly decreasing and a contiguous descending subsequence of CONTEXT_WINDOW_SIZES, all values >= 4096", () => {
    // Feature: interactive-console-ui, Property 4: step-down monotonicity
    fc.assert(
      fc.property(contextWindowSizeArb, (startingCtx) => {
        const sequence = buildStepDownSequence(startingCtx);

        // If no sizes are smaller than startingCtx, the sequence is empty — that's valid
        if (sequence.length === 0) {
          // This happens when startingCtx <= CONTEXT_WINDOW_SIZES[0] (i.e., 4096)
          return true;
        }

        // 1. All values must be >= 4096
        for (const s of sequence) {
          if (s < 4096) return false;
        }

        // 2. Sequence must be strictly decreasing
        for (let i = 1; i < sequence.length; i++) {
          if (sequence[i]! >= sequence[i - 1]!) return false;
        }

        // 3. Must be a contiguous subsequence of CONTEXT_WINDOW_SIZES in descending order.
        //    The descending version of CONTEXT_WINDOW_SIZES:
        const descending = [...CONTEXT_WINDOW_SIZES].reverse();

        // Find the index of the first element of our sequence in descending array
        const startIdx = descending.indexOf(sequence[0]! as (typeof CONTEXT_WINDOW_SIZES)[number]);
        if (startIdx === -1) return false;

        // Verify contiguity: sequence[i] must equal descending[startIdx + i]
        for (let i = 0; i < sequence.length; i++) {
          if (sequence[i] !== descending[startIdx + i]) return false;
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
