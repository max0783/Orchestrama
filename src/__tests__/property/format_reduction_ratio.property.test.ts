// Feature: dual-console-separation, Property 11: Reduction ratio is formatted as a percentage
// For any reduction ratio value r in the range [0, 1],
// formatReductionRatio(r) SHALL return a string equal to (r * 100).toFixed(1) + "%".
//
// **Validates: Requirements 6.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatReductionRatio } from "../../console/formatters.js";

describe("Property 11: Reduction ratio is formatted as a percentage", () => {
  it(
    "formatReductionRatio(r) === (r * 100).toFixed(1) + '%' for all r in [0, 1]",
    () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1, noNaN: true }),
          (r) => {
            const expected = (r * 100).toFixed(1) + "%";
            expect(formatReductionRatio(r)).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
