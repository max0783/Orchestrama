/**
 * Property-based tests for formatBenchmarkReport.
 *
 * // Feature: dual-console-separation, Property 7: Benchmark report is displayed for any result
 *
 * Validates: Requirements 4.2, 4.4
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatBenchmarkReport } from "../../console/formatters.js";

// ---------------------------------------------------------------------------
// Property 7: Benchmark report is displayed for any result
// ---------------------------------------------------------------------------

describe("Property 7: Benchmark report is displayed for any result", () => {
  // Feature: dual-console-separation, Property 7: Benchmark report is displayed for any result
  it("formatBenchmarkReport contains every model name from the results", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            model: fc.string({ minLength: 1 }),
            tasks: fc.array(fc.anything()),
            status: fc.option(fc.constant("ERROR" as const)),
            error: fc.option(fc.string()),
          }),
          { minLength: 1 }
        ),
        (results) => {
          // Normalize fc.option results: fc.option returns null when not present
          const normalized = results.map((r) => ({
            model: r.model,
            tasks: r.tasks as unknown[],
            status: r.status ?? undefined,
            error: r.error ?? undefined,
          }));

          const output = formatBenchmarkReport(normalized);

          // Every model name must appear in the output
          for (const result of normalized) {
            expect(output).toContain(result.model);
          }
        }
      )
    );
  });
});
