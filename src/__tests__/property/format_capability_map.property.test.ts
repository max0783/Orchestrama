// Feature: dual-console-separation, Property 9: Capability map resolve shows the resolved model
// For any CapabilityMap and any prompt string, formatCapabilityMap with a resolved
// object SHALL display the model name that was resolved for that prompt.
//
// **Validates: Requirements 5.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatCapabilityMap } from "../../console/formatters.js";

describe("Property 9: Capability map resolve shows the resolved model", () => {
  it(
    "output contains the resolved model name when resolved is provided",
    () => {
      fc.assert(
        fc.property(
          fc.record({
            map: fc.dictionary(
              fc.string({ minLength: 1 }),
              fc.string({ minLength: 1 })
            ),
            prompt: fc.string(),
            model: fc.string({ minLength: 1 }),
          }),
          ({ map, prompt, model }) => {
            const output = formatCapabilityMap(map, { prompt, model });
            expect(output).toContain(model);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "output contains every pattern→model pair from the map",
    () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1 }),
            fc.string({ minLength: 1 })
          ).filter((m) => Object.keys(m).length > 0),
          (map) => {
            const output = formatCapabilityMap(map);
            for (const [pattern, model] of Object.entries(map)) {
              expect(output).toContain(pattern);
              expect(output).toContain(model);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
