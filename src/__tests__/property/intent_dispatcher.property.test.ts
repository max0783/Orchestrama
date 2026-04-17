// Feature: smart-mcp-self-description
// Property tests for IntentDispatcher (Properties 1, 2, 4)
//
// **Validates: Requirements 1.1, 1.2, 1.5, 1.6**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PatternRegistry } from "../../patterns/registry.js";
import { IntentDispatcher } from "../../patterns/dispatcher.js";

// ---------------------------------------------------------------------------
// Constants — must match the built-in definitions in registry.ts
// ---------------------------------------------------------------------------

const BUILT_IN_NAMES = [
  "code_review",
  "explain_code",
  "find_bugs",
  "find_ts_errors",
  "generate_tests",
  "log_analysis",
  "replace_text",
  "summarize",
] as const;

/**
 * All keywords from every built-in pattern.
 * Used to ensure "no-match" strings don't accidentally collide.
 */
const ALL_BUILT_IN_KEYWORDS = [
  "typescript",
  "ts errors",
  "type errors",
  "missing imports",
  "replace",
  "substitution",
  "find and replace",
  "bugs",
  "defects",
  "issues",
  "problems",
  "review",
  "code review",
  "refactor",
  "lint",
  "summarize",
  "summary",
  "tldr",
  "brief",
  "log",
  "logs",
  "error log",
  "trace",
  "debug",
  "explain",
  "what does",
  "how does",
  "understand",
  "generate tests",
  "write tests",
  "test cases",
  "unit tests",
];

/** All built-in names as a Set for fast membership checks */
const BUILT_IN_NAMES_SET = new Set<string>(BUILT_IN_NAMES);

/**
 * Returns true if the given string would match any built-in pattern
 * (either as a name or as a keyword substring match in either direction).
 */
function matchesAnyBuiltIn(s: string): boolean {
  const lower = s.toLowerCase();

  // Name match
  for (const name of BUILT_IN_NAMES) {
    if (name === lower) return true;
  }

  // Keyword substring match (both directions, as the dispatcher does)
  for (const kw of ALL_BUILT_IN_KEYWORDS) {
    const lowerKw = kw.toLowerCase();
    if (lower.includes(lowerKw) || lowerKw.includes(lower)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Non-empty, non-whitespace-only string */
const nonEmptyString = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

/**
 * Valid custom pattern name: non-empty, not a built-in name, and not a string
 * that would accidentally match any built-in keyword.
 */
const customPatternName = fc
  .string({ minLength: 3 })
  .filter(
    (s) =>
      s.trim().length > 0 &&
      !BUILT_IN_NAMES_SET.has(s.toLowerCase()) &&
      !matchesAnyBuiltIn(s)
  );

// ---------------------------------------------------------------------------
// Property 1: Intent dispatch matches correct pattern
// **Validates: Requirements 1.1, 1.5**
// ---------------------------------------------------------------------------

describe("Property 1: Intent dispatch matches correct pattern", () => {
  it("resolves built-in pattern names to the correct pattern (exact name match)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...BUILT_IN_NAMES),
        async (builtInName) => {
          const registry = new PatternRegistry();
          const dispatcher = new IntentDispatcher(registry);

          const result = dispatcher.resolve(builtInName);

          expect(result).not.toBeNull();
          expect(result!.pattern.name).toBe(builtInName);
          expect(result!.matchedBy).toBe("name");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("resolves built-in pattern keywords to the correct pattern (keyword match)", async () => {
    // Build a flat list of (keyword, expectedPatternName) pairs from the registry
    const registry = new PatternRegistry();
    const allPatterns = registry.list();
    const keywordPairs: Array<{ keyword: string; patternName: string }> = [];
    for (const pattern of allPatterns) {
      for (const kw of pattern.keywords) {
        keywordPairs.push({ keyword: kw, patternName: pattern.name });
      }
    }

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...keywordPairs),
        async ({ keyword, patternName }) => {
          const reg = new PatternRegistry();
          const dispatcher = new IntentDispatcher(reg);

          // Use the keyword itself as the intent — guaranteed to match
          const result = dispatcher.resolve(keyword);

          expect(result).not.toBeNull();
          expect(result!.pattern.name).toBe(patternName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("resolves custom pattern names to the correct pattern", async () => {
    await fc.assert(
      fc.asyncProperty(
        customPatternName,
        nonEmptyString,
        async (name, description) => {
          const registry = new PatternRegistry();
          await registry.register(name, description);

          const dispatcher = new IntentDispatcher(registry);
          // The registry stores the trimmed name; resolve using the trimmed name
          const trimmedName = name.trim();
          const result = dispatcher.resolve(trimmedName);

          expect(result).not.toBeNull();
          expect(result!.pattern.name).toBe(trimmedName);
          expect(result!.matchedBy).toBe("name");
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: No-match falls back gracefully
// **Validates: Requirements 1.2, 1.6**
// ---------------------------------------------------------------------------

describe("Property 2: No-match falls back gracefully", () => {
  it("returns null for intent strings that don't match any built-in name or keyword", async () => {
    /**
     * Generate strings that are guaranteed not to match any built-in name or keyword.
     * We use a prefix "xyzzy_no_match_" combined with a hex suffix to ensure uniqueness.
     */
    const noMatchIntent = fc
      .hexaString({ minLength: 8, maxLength: 16 })
      .map((hex) => `xyzzy_no_match_${hex}`)
      .filter((s) => !matchesAnyBuiltIn(s));

    await fc.assert(
      fc.asyncProperty(noMatchIntent, async (intent) => {
        const registry = new PatternRegistry();
        const dispatcher = new IntentDispatcher(registry);

        const result = dispatcher.resolve(intent);

        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("returns null even when custom patterns are registered, if intent doesn't match any", async () => {
    /**
     * Register some custom patterns, then resolve an intent that doesn't match
     * any of them (or any built-in).
     */
    const noMatchIntent = fc
      .hexaString({ minLength: 8, maxLength: 16 })
      .map((hex) => `xyzzy_no_match_${hex}`)
      .filter((s) => !matchesAnyBuiltIn(s));

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ name: customPatternName, description: nonEmptyString }),
          { minLength: 0, maxLength: 5 }
        ),
        noMatchIntent,
        async (patterns, intent) => {
          // Deduplicate by name
          const seen = new Set<string>();
          const unique = patterns.filter((p) => {
            const key = p.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          // Also ensure the intent doesn't match any custom pattern name or keyword
          // (custom patterns have empty keywords by default, so only name collision matters)
          const intentLower = intent.toLowerCase();
          const safeUnique = unique.filter(
            (p) => p.name.toLowerCase() !== intentLower
          );

          const registry = new PatternRegistry();
          for (const { name, description } of safeUnique) {
            await registry.register(name, description);
          }

          const dispatcher = new IntentDispatcher(registry);
          const result = dispatcher.resolve(intent);

          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Intent matching is case-insensitive
// **Validates: Requirements 1.5**
// ---------------------------------------------------------------------------

describe("Property 4: Intent matching is case-insensitive", () => {
  it("resolves built-in pattern names identically regardless of case", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...BUILT_IN_NAMES),
        async (builtInName) => {
          const registry = new PatternRegistry();
          const dispatcher = new IntentDispatcher(registry);

          const resultOriginal = dispatcher.resolve(builtInName);
          const resultUpper = dispatcher.resolve(builtInName.toUpperCase());
          const resultLower = dispatcher.resolve(builtInName.toLowerCase());

          // All three must match
          expect(resultOriginal).not.toBeNull();
          expect(resultUpper).not.toBeNull();
          expect(resultLower).not.toBeNull();

          // All three must return the same pattern
          expect(resultUpper!.pattern.name).toBe(resultOriginal!.pattern.name);
          expect(resultLower!.pattern.name).toBe(resultOriginal!.pattern.name);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("resolves built-in keywords identically regardless of case", async () => {
    // Build keyword list from the registry
    const registry = new PatternRegistry();
    const allPatterns = registry.list();
    const keywordPairs: Array<{ keyword: string; patternName: string }> = [];
    for (const pattern of allPatterns) {
      for (const kw of pattern.keywords) {
        keywordPairs.push({ keyword: kw, patternName: pattern.name });
      }
    }

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...keywordPairs),
        async ({ keyword, patternName }) => {
          const reg = new PatternRegistry();
          const dispatcher = new IntentDispatcher(reg);

          const resultOriginal = dispatcher.resolve(keyword);
          const resultUpper = dispatcher.resolve(keyword.toUpperCase());
          const resultLower = dispatcher.resolve(keyword.toLowerCase());

          // All three must match the same pattern
          expect(resultOriginal).not.toBeNull();
          expect(resultUpper).not.toBeNull();
          expect(resultLower).not.toBeNull();

          expect(resultOriginal!.pattern.name).toBe(patternName);
          expect(resultUpper!.pattern.name).toBe(patternName);
          expect(resultLower!.pattern.name).toBe(patternName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("resolves custom pattern names identically regardless of case", async () => {
    await fc.assert(
      fc.asyncProperty(
        customPatternName,
        nonEmptyString,
        async (name, description) => {
          const registry = new PatternRegistry();
          await registry.register(name, description);

          const dispatcher = new IntentDispatcher(registry);

          const trimmedName = name.trim();
          const resultOriginal = dispatcher.resolve(trimmedName);
          const resultUpper = dispatcher.resolve(trimmedName.toUpperCase());
          const resultLower = dispatcher.resolve(trimmedName.toLowerCase());

          // All three must match
          expect(resultOriginal).not.toBeNull();
          expect(resultUpper).not.toBeNull();
          expect(resultLower).not.toBeNull();

          // All three must return the same pattern
          expect(resultUpper!.pattern.name).toBe(resultOriginal!.pattern.name);
          expect(resultLower!.pattern.name).toBe(resultOriginal!.pattern.name);
        }
      ),
      { numRuns: 100 }
    );
  });
});
