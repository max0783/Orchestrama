/**
 * Unit tests for src/advisor/context_checker.ts
 */

import { describe, it, expect } from "vitest";
import {
  estimateContextVramMb,
  findSafeContextWindows,
  formatContextWindowSummary,
} from "../../advisor/context_checker.js";
import type { ContextWindowResult } from "../../advisor/types.js";

// ---------------------------------------------------------------------------
// estimateContextVramMb
// ---------------------------------------------------------------------------

describe("estimateContextVramMb", () => {
  it("4096 tokens at 2 bytes/token → ~0.0078125 MB", () => {
    const result = estimateContextVramMb(4096);
    expect(result).toBeCloseTo(4096 * 2 / (1024 * 1024), 10);
  });

  it("131072 tokens at 2 bytes/token → 0.25 MB", () => {
    const result = estimateContextVramMb(131072);
    expect(result).toBeCloseTo(131072 * 2 / (1024 * 1024), 10);
  });

  it("4096 tokens at 4 bytes/token → ~0.015625 MB", () => {
    const result = estimateContextVramMb(4096, 4);
    expect(result).toBeCloseTo(4096 * 4 / (1024 * 1024), 10);
  });
});

// ---------------------------------------------------------------------------
// findSafeContextWindows
// ---------------------------------------------------------------------------

describe("findSafeContextWindows", () => {
  it("model with 4000 MB VRAM, budget 4096 MB: 4096 tokens context is safe", () => {
    const result = findSafeContextWindows(4000, 4096);
    expect(result.safeContextSizes).toContain(4096);
    expect(result.maxSafeContextTokens).not.toBeNull();
  });

  it("model with 4095 MB VRAM, budget 4096 MB: only 1 MB remaining, 4096 tokens is safe", () => {
    const result = findSafeContextWindows(4095, 4096);
    // 4096 tokens * 2 bytes / (1024*1024) ≈ 0.0078 MB, which fits in 1 MB
    expect(result.safeContextSizes).toContain(4096);
  });

  it("model with 4096 MB VRAM, budget 4096 MB: 0 MB remaining → no safe context windows", () => {
    const result = findSafeContextWindows(4096, 4096);
    expect(result.safeContextSizes).toHaveLength(0);
    expect(result.maxSafeContextTokens).toBeNull();
  });

  it("model with 0 MB VRAM, budget 8192 MB: all 6 sizes should be safe", () => {
    const result = findSafeContextWindows(0, 8192);
    expect(result.safeContextSizes).toHaveLength(6);
    expect(result.maxSafeContextTokens).toBe(131072);
  });

  it("returns modelName as empty string (caller sets it)", () => {
    const result = findSafeContextWindows(0, 8192);
    expect(result.modelName).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatContextWindowSummary
// ---------------------------------------------------------------------------

describe("formatContextWindowSummary", () => {
  it("empty list → '(no models to display)'", () => {
    expect(formatContextWindowSummary([])).toBe("(no models to display)");
  });

  it("model with maxSafeContextTokens = 32768 → contains the formatted number 32768", () => {
    const results: ContextWindowResult[] = [
      {
        modelName: "llama3:7b",
        maxSafeContextTokens: 32768,
        safeContextSizes: [4096, 8192, 16384, 32768],
      },
    ];
    const output = formatContextWindowSummary(results);
    // The formatter uses toLocaleString() without explicit locale; match what the runtime produces
    expect(output).toContain((32768).toLocaleString());
  });

  it("model with maxSafeContextTokens = null → contains 'none'", () => {
    const results: ContextWindowResult[] = [
      {
        modelName: "llama3:70b",
        maxSafeContextTokens: null,
        safeContextSizes: [],
      },
    ];
    const output = formatContextWindowSummary(results);
    expect(output).toContain("none");
  });
});
