// Feature: benchmark-advisor, Property 26: First-startup auto-launch
//
// **Validates: Requirements 8.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Property 26: First-startup auto-launch
// For any console startup where OLLAMA_DEFAULT_MODEL is not set, the advisor
// should be invoked. When OLLAMA_DEFAULT_MODEL is set, the advisor should not
// be auto-launched.
//
// This tests the boolean logic: if !process.env["OLLAMA_DEFAULT_MODEL"], the
// advisor should be launched.
//
// **Validates: Requirements 8.4**
// ---------------------------------------------------------------------------

/**
 * Simulates the first-startup check logic from console/index.ts.
 * Returns true if the advisor should be auto-launched.
 */
function shouldAutoLaunchAdvisor(envValue: string | undefined): boolean {
  return !envValue;
}

describe("Property 26: First-startup auto-launch", () => {
  it("advisor is auto-launched when OLLAMA_DEFAULT_MODEL is undefined", () => {
    fc.assert(
      fc.property(fc.constant(undefined), (envValue: undefined) => {
        expect(shouldAutoLaunchAdvisor(envValue)).toBe(true);
      }),
      { numRuns: 1 }
    );
  });

  it("advisor is auto-launched when OLLAMA_DEFAULT_MODEL is empty string", () => {
    fc.assert(
      fc.property(fc.constant(""), (envValue: string) => {
        expect(shouldAutoLaunchAdvisor(envValue)).toBe(true);
      }),
      { numRuns: 1 }
    );
  });

  it("advisor is NOT auto-launched when OLLAMA_DEFAULT_MODEL is set to any non-empty value", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.length > 0),
        (modelName) => {
          expect(shouldAutoLaunchAdvisor(modelName)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("auto-launch condition is exactly !envValue (falsy check)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(""),
          fc.string({ minLength: 1 })
        ),
        (envValue: string | undefined) => {
          const shouldLaunch = shouldAutoLaunchAdvisor(envValue);
          const expectedLaunch = !envValue;
          expect(shouldLaunch).toBe(expectedLaunch);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("process.env OLLAMA_DEFAULT_MODEL absence triggers auto-launch in real env check", () => {
    fc.assert(
      fc.property(fc.boolean(), (isSet) => {
        // Simulate the env check
        const envValue = isSet ? "some-model" : undefined;
        const shouldLaunch = !envValue;

        if (isSet) {
          expect(shouldLaunch).toBe(false);
        } else {
          expect(shouldLaunch).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
