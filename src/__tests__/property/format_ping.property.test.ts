// Feature: dual-console-separation, Property 5: Ping output contains status and response time
// For any model name and any ping result (warm or cold, any response time in ms),
// the formatted output of formatPingResult SHALL contain the model name,
// the warm/cold status string, and the numeric response time.
//
// **Validates: Requirements 3.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatPingResult } from "../../console/formatters.js";

describe("Property 5: Ping output contains status and response time", () => {
  it(
    "output contains model name, warm/cold status, and numeric response time",
    () => {
      fc.assert(
        fc.property(
          fc.record({
            model: fc.string({ minLength: 1 }),
            loaded: fc.boolean(),
            responseTimeMs: fc.nat(),
          }),
          ({ model, loaded, responseTimeMs }) => {
            const output = formatPingResult(model, { loaded, responseTimeMs });

            // Must contain the model name
            expect(output).toContain(model);

            // Must contain warm or cold (not both)
            if (loaded) {
              expect(output).toContain("warm");
            } else {
              expect(output).toContain("cold");
            }

            // Must contain the numeric response time
            expect(output).toContain(String(responseTimeMs));
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
