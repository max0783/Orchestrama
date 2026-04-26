// Feature: orchestrama, Property 10: Model resolution precedence
// For any invocation, the model used should follow this precedence:
//   (1) explicit `model` parameter if provided,
//   (2) first capability-map pattern match if no explicit model,
//   (3) OLLAMA_DEFAULT_MODEL / defaultModel,
//   (4) "llama3" as ultimate default.
//
// **Validates: Requirements 5.1, 5.2, 5.3, 14.3, 14.4, 14.5**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { CapabilityRouter } from "../../routing/capability_map.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Arbitrary non-empty, non-whitespace-only string. */
const nonEmptyString = fc.string({ minLength: 1, maxLength: 80 }).filter(
  (s) => s.trim() !== ""
);

/** Arbitrary capability map with 1–5 entries. */
const capabilityMapArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== ""),
  nonEmptyString,
  { minKeys: 1, maxKeys: 5 }
);

// ---------------------------------------------------------------------------
// Property 10 tests
// ---------------------------------------------------------------------------

describe("Property 10: Model resolution precedence", () => {
  it("(1) explicit model always wins regardless of capability map or default", () => {
    fc.assert(
      fc.property(
        capabilityMapArb,
        nonEmptyString, // defaultModel
        fc.string({ maxLength: 200 }), // prompt
        nonEmptyString, // explicitModel
        (capMap, defaultModel, prompt, explicitModel) => {
          const router = new CapabilityRouter(capMap, defaultModel);
          const result = router.resolveModel(prompt, explicitModel);
          expect(result).toBe(explicitModel);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("(2) capability-map first match wins when no explicit model is given", () => {
    fc.assert(
      fc.property(
        // pattern that will definitely appear in the prompt
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== "" && !s.includes("\0")),
        nonEmptyString, // model associated with the pattern
        nonEmptyString, // defaultModel (different from pattern model)
        (pattern, patternModel, defaultModel) => {
          // Build a prompt that contains the pattern
          const prompt = `prefix ${pattern} suffix`;
          const capMap = { [pattern]: patternModel };
          const router = new CapabilityRouter(capMap, defaultModel);
          const result = router.resolveModel(prompt);
          expect(result).toBe(patternModel);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("(3) defaultModel is used when no explicit model and no capability-map match", () => {
    fc.assert(
      fc.property(
        nonEmptyString, // defaultModel
        fc.string({ maxLength: 200 }), // prompt (will not contain the pattern)
        (defaultModel, prompt) => {
          // Use a pattern that cannot appear in the prompt
          const capMap = { "\x01\x02\x03": "some-model" };
          const router = new CapabilityRouter(capMap, defaultModel);
          const result = router.resolveModel(prompt);
          expect(result).toBe(defaultModel);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("(4) falls back to 'llama3.1:8b' when defaultModel is empty and no match", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(""), fc.constant("   ")),
        fc.string({ maxLength: 200 }),
        (emptyDefault, prompt) => {
          // Use a pattern that cannot appear in the prompt
          const capMap = { "\x01\x02\x03": "some-model" };
          const router = new CapabilityRouter(capMap, emptyDefault);
          const result = router.resolveModel(prompt);
          expect(result).toBe("llama3.1:8b");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("explicit empty/whitespace-only model is NOT treated as explicit — falls through to map/default", () => {
    fc.assert(
      fc.property(
        nonEmptyString, // defaultModel
        fc.string({ maxLength: 200 }), // prompt
        fc.oneof(fc.constant(""), fc.constant("   ")),
        (defaultModel, prompt, emptyExplicit) => {
          // No matching pattern in the map
          const capMap = { "\x01\x02\x03": "some-model" };
          const router = new CapabilityRouter(capMap, defaultModel);
          const result = router.resolveModel(prompt, emptyExplicit);
          // Should fall through to defaultModel
          expect(result).toBe(defaultModel);
        }
      ),
      { numRuns: 100 }
    );
  });
});
