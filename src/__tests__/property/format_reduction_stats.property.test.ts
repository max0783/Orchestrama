// Feature: dual-console-separation, Property 10: Reduction stats display contains all aggregate fields and breakdowns
// For any ReductionStats object, the formatted stats output SHALL contain the total
// invocations count, the average reduction ratio formatted as a percentage, the total
// tokens saved, and every key from byModel and byTaskType.
//
// **Validates: Requirements 6.1, 6.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatReductionStats } from "../../console/formatters.js";
import type { ReductionStats } from "../../logging/reduction_logger.js";

// Arbitrary for a single model/task-type breakdown entry
const breakdownEntryArb = fc.record({
  invocations: fc.integer({ min: 1, max: 1000 }),
  averageReductionRatio: fc.float({ min: 0, max: 1, noNaN: true }),
});

// Arbitrary for ReductionStats
const reductionStatsArb: fc.Arbitrary<ReductionStats> = fc.record({
  totalInvocations: fc.integer({ min: 0, max: 10000 }),
  averageReductionRatio: fc.float({ min: 0, max: 1, noNaN: true }),
  totalTokensSaved: fc.integer({ min: 0, max: 1000000 }),
  byModel: fc.dictionary(fc.string({ minLength: 1 }), breakdownEntryArb),
  byTaskType: fc.dictionary(fc.string({ minLength: 1 }), breakdownEntryArb),
});

describe("Property 10: Reduction stats display contains all aggregate fields and breakdowns", () => {
  it(
    "output contains totalInvocations, averageReductionRatio as %, and totalTokensSaved",
    () => {
      fc.assert(
        fc.property(reductionStatsArb, (stats) => {
          const output = formatReductionStats(stats);

          expect(output).toContain("totalInvocations");
          expect(output).toContain(String(stats.totalInvocations));

          expect(output).toContain("averageReductionRatio");
          // Should be formatted as a percentage
          expect(output).toContain("%");

          expect(output).toContain("totalTokensSaved");
          expect(output).toContain(String(stats.totalTokensSaved));
        }),
        { numRuns: 100 }
      );
    }
  );

  it(
    "output contains every key from byModel",
    () => {
      fc.assert(
        fc.property(
          reductionStatsArb.filter(
            (s) => Object.keys(s.byModel).length > 0
          ),
          (stats) => {
            const output = formatReductionStats(stats);
            for (const modelKey of Object.keys(stats.byModel)) {
              expect(output).toContain(modelKey);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "output contains every key from byTaskType",
    () => {
      fc.assert(
        fc.property(
          reductionStatsArb.filter(
            (s) => Object.keys(s.byTaskType).length > 0
          ),
          (stats) => {
            const output = formatReductionStats(stats);
            for (const taskTypeKey of Object.keys(stats.byTaskType)) {
              expect(output).toContain(taskTypeKey);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
