// Feature: dual-console-separation, Property 4: List models output contains all available model names
// For any non-empty list of model names, the formatted output of formatModelList
// SHALL contain every model name from that list.
//
// **Validates: Requirements 3.1**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatModelList } from "../../console/formatters.js";

describe("Property 4: List models output contains all available model names", () => {
  it(
    "every model name appears in formatModelList output",
    () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
          (models) => {
            const output = formatModelList(models);
            for (const model of models) {
              expect(output).toContain(model);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "empty list returns a non-empty 'no models' message",
    () => {
      const output = formatModelList([]);
      expect(output.length).toBeGreaterThan(0);
      expect(output.toLowerCase()).toContain("no models");
    }
  );
});
