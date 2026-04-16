// Feature: dual-console-separation, Property 12: Health check display shows correct indicators and lists all failures
// For any array of CheckResult objects, the formatted health check output SHALL:
// - Display ✅ for every PASS result
// - Display ❌ for every FAIL result
// - Display ⏭️ for every SKIPPED result
// - Include the resolution hint for every FAIL result that has one
// - List every failed check name in the summary when at least one check fails
//
// **Validates: Requirements 7.2, 7.5**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatCheckResults } from "../../console/formatters.js";
import type { CheckResult } from "../../tools/test_config.js";

// Arbitrary for a single CheckResult
const checkResultArb: fc.Arbitrary<CheckResult> = fc.record({
  name: fc.string({ minLength: 1 }),
  status: fc.constantFrom("PASS" as const, "FAIL" as const, "SKIPPED" as const),
  message: fc.string(),
  resolution: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  responseTimeMs: fc.option(fc.nat(), { nil: undefined }),
});

describe("Property 12: Health check display shows correct indicators and lists all failures", () => {
  it(
    "output contains ✅ for every PASS, ❌ for every FAIL, ⏭️ for every SKIPPED",
    () => {
      fc.assert(
        fc.property(
          fc.array(checkResultArb, { minLength: 1, maxLength: 10 }),
          (checks) => {
            const output = formatCheckResults(checks);

            const passCount = checks.filter((c) => c.status === "PASS").length;
            const failCount = checks.filter((c) => c.status === "FAIL").length;
            const skippedCount = checks.filter((c) => c.status === "SKIPPED").length;

            // Count occurrences of each icon in the output
            const passMatches = (output.match(/✅/g) ?? []).length;
            const failMatches = (output.match(/❌/g) ?? []).length;
            const skippedMatches = (output.match(/⏭️/g) ?? []).length;

            // Each PASS check should produce at least one ✅
            if (passCount > 0) {
              expect(passMatches).toBeGreaterThanOrEqual(passCount);
            }
            // Each FAIL check should produce at least one ❌
            if (failCount > 0) {
              expect(failMatches).toBeGreaterThanOrEqual(failCount);
            }
            // Each SKIPPED check should produce at least one ⏭️
            if (skippedCount > 0) {
              expect(skippedMatches).toBeGreaterThanOrEqual(skippedCount);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "output includes resolution hint for every FAIL result that has one",
    () => {
      fc.assert(
        fc.property(
          fc.array(checkResultArb, { minLength: 1, maxLength: 10 }),
          (checks) => {
            const output = formatCheckResults(checks);

            for (const check of checks) {
              if (check.status === "FAIL" && check.resolution) {
                expect(output).toContain(check.resolution);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "output lists every failed check name in the summary when at least one fails",
    () => {
      fc.assert(
        fc.property(
          fc.array(checkResultArb, { minLength: 1, maxLength: 10 }).filter(
            (checks) => checks.some((c) => c.status === "FAIL")
          ),
          (checks) => {
            const output = formatCheckResults(checks);
            const failedChecks = checks.filter((c) => c.status === "FAIL");

            // The summary section is after the last separator
            const parts = output.split("=".repeat(40));
            const summary = parts[parts.length - 1] ?? "";

            for (const check of failedChecks) {
              expect(summary).toContain(check.name);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
