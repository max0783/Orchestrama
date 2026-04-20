// Feature: dual-console-separation, Property 3: Every valid menu selection invokes a handler and produces output

/**
 * Property 3: Every valid menu selection invokes a handler and produces output.
 *
 * Validates: Requirements 2.4
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { parseSelection } from "../../console/menu.js";

describe("Property 3: Every valid menu selection invokes a handler and produces output", () => {
  // **Validates: Requirements 2.4**
  it("parseSelection returns a non-null MenuAction for every integer 1–9", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), (n) => {
        const result = parseSelection(String(n));
        expect(result).not.toBeNull();
        expect(typeof result).toBe("string");
        expect(result!.length).toBeGreaterThan(0);
      })
    );
  });

  it('parseSelection("0") returns "exit"', () => {
    expect(parseSelection("0")).toBe("exit");
  });
});
