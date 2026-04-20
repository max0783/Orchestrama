/**
 * ContextWindowChecker — determines the maximum safe context window for each
 * candidate model given the available VRAM budget.
 */

import type { ContextWindowResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTEXT_WINDOW_SIZES = [4096, 8192, 16384, 32768, 65536, 131072] as const;
export type ContextWindowSize = (typeof CONTEXT_WINDOW_SIZES)[number];

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Estimate the VRAM required (in MB) to hold a KV-cache for the given number
 * of context tokens.
 *
 * Formula: contextTokens × bytesPerToken / (1024 × 1024)
 *
 * @param contextTokens  Number of tokens in the context window.
 * @param bytesPerToken  Bytes per token in the KV cache (default 2 for FP16).
 * @returns Estimated VRAM in MB.
 */
export function estimateContextVramMb(
  contextTokens: number,
  bytesPerToken: number = 2
): number {
  return (contextTokens * bytesPerToken) / (1024 * 1024);
}

/**
 * Find all context window sizes from `CONTEXT_WINDOW_SIZES` that fit within
 * the remaining VRAM budget after accounting for the model's own VRAM usage.
 *
 * A context window is considered safe when:
 *   modelVramMb + estimateContextVramMb(contextSize, bytesPerToken) <= vramBudgetMb
 *
 * @param modelVramMb   Estimated VRAM consumed by the model weights (MB).
 * @param vramBudgetMb  Total VRAM budget available (MB).
 * @param bytesPerToken Bytes per token in the KV cache (default 2 for FP16).
 * @returns A `ContextWindowResult` with `modelName` left as an empty string
 *          (the caller is responsible for setting it).
 */
export function findSafeContextWindows(
  modelVramMb: number,
  vramBudgetMb: number,
  bytesPerToken: number = 2
): ContextWindowResult {
  const safeContextSizes: ContextWindowSize[] = [];

  for (const size of CONTEXT_WINDOW_SIZES) {
    const contextVram = estimateContextVramMb(size, bytesPerToken);
    if (modelVramMb + contextVram <= vramBudgetMb) {
      safeContextSizes.push(size);
    }
  }

  const maxSafeContextTokens =
    safeContextSizes.length > 0
      ? safeContextSizes[safeContextSizes.length - 1]!
      : null;

  return {
    modelName: "",
    safeContextSizes,
    maxSafeContextTokens,
  };
}

/**
 * Format a human-readable summary of context window results for a list of
 * models.
 *
 * Each line shows:
 *   <modelName>: max safe context = <N> tokens  (safe sizes: 4096, 8192, ...)
 * or:
 *   <modelName>: max safe context = none  (no context window fits in budget)
 *
 * @param results  Array of `ContextWindowResult` objects (one per model).
 * @returns Multi-line string, one line per model.
 */
export function formatContextWindowSummary(results: ContextWindowResult[]): string {
  if (results.length === 0) {
    return "(no models to display)";
  }

  return results
    .map((r) => {
      const maxStr =
        r.maxSafeContextTokens !== null
          ? `${r.maxSafeContextTokens.toLocaleString()} tokens`
          : "none";

      const sizesStr =
        r.safeContextSizes.length > 0
          ? `safe sizes: ${r.safeContextSizes.map((s) => s.toLocaleString()).join(", ")}`
          : "no safe sizes";

      return `${r.modelName}: max safe context = ${maxStr}  (${sizesStr})`;
    })
    .join("\n");
}
