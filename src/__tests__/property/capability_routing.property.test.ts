// Feature: ollama-mcp-bridge, Property 15: Capability map first-match routing
// For any prompt string and capability map, resolveModel(prompt) should return
// the model associated with the first pattern (in insertion order) that is a
// case-insensitive substring of the prompt, or the default model if no pattern
// matches.
//
// **Validates: Requirements 14.3, 14.4, 14.5**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { CapabilityRouter } from "../../routing/capability_map.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Arbitrary non-empty, non-whitespace-only string. */
const nonEmptyString = fc.string({ minLength: 1, maxLength: 60 }).filter(
  (s) => s.trim() !== ""
);

// ---------------------------------------------------------------------------
// Property 15 tests
// ---------------------------------------------------------------------------

describe("Property 15: Capability map first-match routing", () => {
  it("returns the model for a pattern that appears in the prompt", () => {
    fc.assert(
      fc.property(
        // pattern that will be embedded in the prompt
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => s.trim() !== "" && !s.includes("\0")
        ),
        nonEmptyString, // model for that pattern
        nonEmptyString, // defaultModel
        (pattern, model, defaultModel) => {
          const prompt = `some text ${pattern} more text`;
          const capMap = { [pattern]: model };
          const router = new CapabilityRouter(capMap, defaultModel);
          expect(router.resolveModel(prompt)).toBe(model);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns defaultModel when no pattern matches the prompt", () => {
    fc.assert(
      fc.property(
        nonEmptyString, // defaultModel
        fc.string({ maxLength: 200 }), // prompt
        (defaultModel, prompt) => {
          // Use a pattern that cannot appear in any normal prompt
          const capMap = { "\x01\x02\x03": "unreachable-model" };
          const router = new CapabilityRouter(capMap, defaultModel);
          expect(router.resolveModel(prompt)).toBe(defaultModel);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns the FIRST matching pattern's model (insertion order)", () => {
    fc.assert(
      fc.property(
        // Two distinct patterns that start with a letter (non-integer-like keys),
        // so JS object key ordering matches insertion order.
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/),
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/)
        ).filter(([a, b]) => a !== b && !a.includes(b) && !b.includes(a)),
        nonEmptyString, // model for first pattern
        nonEmptyString, // model for second pattern
        nonEmptyString, // defaultModel
        ([pattern1, pattern2], model1, model2, defaultModel) => {
          // Prompt contains both patterns
          const prompt = `${pattern1} and ${pattern2}`;
          // Build map with pattern1 first, pattern2 second.
          // Because both keys start with a letter, JS preserves insertion order.
          const capMap: Record<string, string> = {};
          capMap[pattern1] = model1;
          capMap[pattern2] = model2;

          const router = new CapabilityRouter(capMap, defaultModel);
          const result = router.resolveModel(prompt);

          // The first pattern in insertion order should win
          expect(result).toBe(model1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("matching is case-insensitive: uppercase pattern matches lowercase prompt", () => {
    fc.assert(
      fc.property(
        // ASCII-only pattern so toUpperCase/toLowerCase are well-defined
        fc.stringMatching(/^[a-z]{1,20}$/),
        nonEmptyString, // model
        nonEmptyString, // defaultModel
        (lowerPattern, model, defaultModel) => {
          const upperPattern = lowerPattern.toUpperCase();
          // Prompt contains the lower-case version; map key is upper-case
          const prompt = `prefix ${lowerPattern} suffix`;
          const capMap = { [upperPattern]: model };
          const router = new CapabilityRouter(capMap, defaultModel);
          expect(router.resolveModel(prompt)).toBe(model);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("matching is case-insensitive: lowercase pattern matches uppercase prompt", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,20}$/),
        nonEmptyString,
        nonEmptyString,
        (lowerPattern, model, defaultModel) => {
          const upperPromptSegment = lowerPattern.toUpperCase();
          const prompt = `prefix ${upperPromptSegment} suffix`;
          const capMap = { [lowerPattern]: model };
          const router = new CapabilityRouter(capMap, defaultModel);
          expect(router.resolveModel(prompt)).toBe(model);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getMap() returns a copy of the capability map", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== ""),
          nonEmptyString,
          { minKeys: 0, maxKeys: 5 }
        ),
        nonEmptyString,
        (capMap, defaultModel) => {
          const router = new CapabilityRouter(capMap, defaultModel);
          const returned = router.getMap();
          // Same entries
          expect(returned).toEqual(capMap);
          // But a different object (shallow copy)
          expect(returned).not.toBe(capMap);
        }
      ),
      { numRuns: 100 }
    );
  });
});
