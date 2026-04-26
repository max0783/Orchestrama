// Feature: smart-mcp-self-description
// Property tests for PatternRegistry (Properties 5–11, 17, 18)
//
// **Validates: Requirements 2.7, 3.1, 3.2, 3.3, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 8.1, 8.2, 8.3, 8.4**

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { PatternRegistry } from "../../patterns/registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUILT_IN_NAMES = new Set([
  "code_review",
  "explain_code",
  "find_bugs",
  "find_ts_errors",
  "generate_tests",
  "log_analysis",
  "replace_text",
  "summarize",
]);

const BUILT_IN_NAMES_ARRAY = [...BUILT_IN_NAMES];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Non-empty, non-whitespace-only string */
const nonEmptyString = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

/** Valid custom pattern name: non-empty, non-whitespace, not a built-in */
const customPatternName = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0 && !BUILT_IN_NAMES.has(s.toLowerCase()));

/** Unique temp file path */
function tmpFilePath(): string {
  return path.join(os.tmpdir(), `pattern_registry_test_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
}

// ---------------------------------------------------------------------------
// Property 5: Built-in pattern immutability
// **Validates: Requirements 2.7, 3.2**
// ---------------------------------------------------------------------------

describe("Property 5: Built-in pattern immutability", () => {
  it("rejects registration of any built-in name and leaves registry unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyString,
        async (description) => {
          for (const builtInName of BUILT_IN_NAMES_ARRAY) {
            const registry = new PatternRegistry();
            const beforeList = registry.list();

            await expect(registry.register(builtInName, description)).rejects.toThrow();

            // Registry state must be unchanged
            const afterList = registry.list();
            expect(afterList).toEqual(beforeList);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Custom pattern registration round-trip
// **Validates: Requirements 3.1, 3.6**
// ---------------------------------------------------------------------------

describe("Property 6: Custom pattern registration round-trip", () => {
  it("get(name) returns a pattern with the same name and description after register()", async () => {
    await fc.assert(
      fc.asyncProperty(
        customPatternName,
        nonEmptyString,
        async (name, description) => {
          const registry = new PatternRegistry();
          await registry.register(name, description);

          const pattern = registry.get(name);
          expect(pattern).toBeDefined();
          expect(pattern!.name).toBe(name.trim());
          expect(pattern!.description).toBe(description.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Custom pattern overwrite
// **Validates: Requirements 3.3**
// ---------------------------------------------------------------------------

describe("Property 7: Custom pattern overwrite", () => {
  it("second registration with same name overwrites the first description", async () => {
    await fc.assert(
      fc.asyncProperty(
        customPatternName,
        nonEmptyString,
        nonEmptyString,
        async (name, description1, description2) => {
          // Ensure the two descriptions are different
          fc.pre(description1.trim() !== description2.trim());

          const registry = new PatternRegistry();
          await registry.register(name, description1);
          await registry.register(name, description2);

          const pattern = registry.get(name);
          expect(pattern).toBeDefined();
          expect(pattern!.description).toBe(description2.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Empty name/description rejection
// **Validates: Requirements 3.5**
// ---------------------------------------------------------------------------

describe("Property 8: Empty name/description rejection", () => {
  const emptyOrWhitespace = fc.constantFrom("", " ", "  ", "\t", "\n", "   \t  ");

  it("rejects registration when name is empty/whitespace and registry is unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        emptyOrWhitespace,
        nonEmptyString,
        async (emptyName, description) => {
          const registry = new PatternRegistry();
          const beforeList = registry.list();

          await expect(registry.register(emptyName, description)).rejects.toThrow();

          const afterList = registry.list();
          expect(afterList).toEqual(beforeList);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects registration when description is empty/whitespace and registry is unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        customPatternName,
        emptyOrWhitespace,
        async (name, emptyDescription) => {
          const registry = new PatternRegistry();
          const beforeList = registry.list();

          await expect(registry.register(name, emptyDescription)).rejects.toThrow();

          const afterList = registry.list();
          expect(afterList).toEqual(beforeList);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: list_patterns completeness
// **Validates: Requirements 4.1, 4.2**
// ---------------------------------------------------------------------------

describe("Property 9: list_patterns completeness", () => {
  it("list() returns all N custom + 8 built-in patterns with required fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: customPatternName,
            description: nonEmptyString,
          }),
          { minLength: 0, maxLength: 10 }
        ),
        async (patterns) => {
          // Deduplicate by name (case-insensitive)
          const seen = new Set<string>();
          const unique = patterns.filter((p) => {
            const key = p.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          const registry = new PatternRegistry();
          for (const { name, description } of unique) {
            await registry.register(name, description);
          }

          const listed = registry.list();

          // Total count: 8 built-ins + N unique custom patterns
          expect(listed.length).toBe(8 + unique.length);

          // Every pattern must have required fields
          for (const p of listed) {
            expect(typeof p.name).toBe("string");
            expect(typeof p.description).toBe("string");
            expect(Array.isArray(p.keywords)).toBe(true);
            expect(typeof p.isBuiltIn).toBe("boolean");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: list_patterns filter correctness
// **Validates: Requirements 4.3**
// ---------------------------------------------------------------------------

describe("Property 10: list_patterns filter correctness", () => {
  it("every returned pattern contains the filter in name or description (case-insensitive)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.array(
          fc.record({
            name: customPatternName,
            description: nonEmptyString,
          }),
          { minLength: 0, maxLength: 5 }
        ),
        async (filter, patterns) => {
          // Deduplicate by name
          const seen = new Set<string>();
          const unique = patterns.filter((p) => {
            const key = p.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          const registry = new PatternRegistry();
          for (const { name, description } of unique) {
            await registry.register(name, description);
          }

          const lowerFilter = filter.trim().toLowerCase();
          const filtered = registry.list(filter);

          // Every returned pattern must match the filter
          for (const p of filtered) {
            const matchesName = p.name.toLowerCase().includes(lowerFilter);
            const matchesDesc = p.description.toLowerCase().includes(lowerFilter);
            expect(matchesName || matchesDesc).toBe(true);
          }

          // No non-matching pattern should appear in results
          const allPatterns = registry.list();
          const nonMatching = allPatterns.filter(
            (p) =>
              !p.name.toLowerCase().includes(lowerFilter) &&
              !p.description.toLowerCase().includes(lowerFilter)
          );
          for (const p of nonMatching) {
            expect(filtered.find((r) => r.name === p.name)).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: list_patterns stable ordering
// **Validates: Requirements 4.4**
// ---------------------------------------------------------------------------

describe("Property 11: list_patterns stable ordering", () => {
  it("built-ins appear before customs, each group sorted alphabetically, two calls return same order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: customPatternName,
            description: nonEmptyString,
          }),
          { minLength: 0, maxLength: 8 }
        ),
        async (patterns) => {
          // Deduplicate by name
          const seen = new Set<string>();
          const unique = patterns.filter((p) => {
            const key = p.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          const registry = new PatternRegistry();
          for (const { name, description } of unique) {
            await registry.register(name, description);
          }

          const list1 = registry.list();
          const list2 = registry.list();

          // Two calls return the same order
          expect(list1.map((p) => p.name)).toEqual(list2.map((p) => p.name));

          // Built-ins come before customs
          const builtInIndices = list1
            .map((p, i) => (p.isBuiltIn ? i : -1))
            .filter((i) => i >= 0);
          const customIndices = list1
            .map((p, i) => (!p.isBuiltIn ? i : -1))
            .filter((i) => i >= 0);

          if (builtInIndices.length > 0 && customIndices.length > 0) {
            const lastBuiltIn = Math.max(...builtInIndices);
            const firstCustom = Math.min(...customIndices);
            expect(lastBuiltIn).toBeLessThan(firstCustom);
          }

          // Built-ins are sorted alphabetically
          const builtIns = list1.filter((p) => p.isBuiltIn);
          for (let i = 1; i < builtIns.length; i++) {
            expect(builtIns[i - 1].name.localeCompare(builtIns[i].name)).toBeLessThanOrEqual(0);
          }

          // Customs are sorted alphabetically
          const customs = list1.filter((p) => !p.isBuiltIn);
          for (let i = 1; i < customs.length; i++) {
            expect(customs[i - 1].name.localeCompare(customs[i].name)).toBeLessThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: Custom pattern persistence round-trip
// **Validates: Requirements 8.1, 8.2, 8.4**
// ---------------------------------------------------------------------------

describe("Property 17: Custom pattern persistence round-trip", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    // Clean up temp files
    for (const f of tempFiles) {
      try {
        await fs.unlink(f);
      } catch {
        // ignore
      }
    }
    tempFiles.length = 0;
  });

  it("loading from file produces equivalent list() output", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: customPatternName,
            description: nonEmptyString,
          }),
          { minLength: 0, maxLength: 8 }
        ),
        async (patterns) => {
          // Deduplicate by name
          const seen = new Set<string>();
          const unique = patterns.filter((p) => {
            const key = p.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          const filePath = tmpFilePath();
          tempFiles.push(filePath);

          // Register patterns in first registry (persists to file)
          const registry1 = new PatternRegistry({ patternsFilePath: filePath });
          for (const { name, description } of unique) {
            await registry1.register(name, description);
          }

          // Load into a second registry from the same file
          const registry2 = new PatternRegistry({ patternsFilePath: filePath });
          await registry2.loadFromFile();

          // Compare custom patterns only (built-ins are always the same)
          const customs1 = registry1.list().filter((p) => !p.isBuiltIn);
          const customs2 = registry2.list().filter((p) => !p.isBuiltIn);

          expect(customs2.length).toBe(customs1.length);

          for (const p1 of customs1) {
            const p2 = customs2.find((p) => p.name === p1.name);
            expect(p2).toBeDefined();
            expect(p2!.description).toBe(p1.description);
            expect(p2!.systemPrompt).toBe(p1.systemPrompt);
            expect(p2!.keywords).toEqual(p1.keywords);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Invalid JSON file produces empty custom set
// **Validates: Requirements 8.3**
// ---------------------------------------------------------------------------

describe("Property 18: Invalid JSON file produces empty custom set", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    for (const f of tempFiles) {
      try {
        await fs.unlink(f);
      } catch {
        // ignore
      }
    }
    tempFiles.length = 0;
  });

  it("loads zero custom patterns and writes a warning to stderr when file contains invalid JSON", async () => {
    const invalidJsonStrings = fc.constantFrom(
      "not json",
      "{invalid}",
      "[1, 2,]",
      "undefined",
      "null",
      "42",
      '{"key": }',
      "true",
      "[]invalid"
    );

    await fc.assert(
      fc.asyncProperty(invalidJsonStrings, async (invalidJson) => {
        const filePath = tmpFilePath();
        tempFiles.push(filePath);

        await fs.writeFile(filePath, invalidJson, "utf-8");

        // Spy on process.stderr.write
        const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

        try {
          const registry = new PatternRegistry({ patternsFilePath: filePath });
          await registry.loadFromFile();

          // Only 8 built-in patterns, no custom patterns
          const listed = registry.list();
          expect(listed.length).toBe(8);
          expect(listed.every((p) => p.isBuiltIn)).toBe(true);

          // A warning must have been written to stderr
          expect(stderrSpy).toHaveBeenCalled();
          const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
          const hasWarning = calls.some((msg) => msg.includes("WARNING"));
          expect(hasWarning).toBe(true);
        } finally {
          stderrSpy.mockRestore();
        }
      }),
      { numRuns: 100 }
    );
  });
});
