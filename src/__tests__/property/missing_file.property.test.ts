// Feature: ollama-mcp-bridge, Property 6: Missing file error marker
// For any path in `context_files` that does not exist on the file system, the
// payload entry for that path should contain `[ERROR: file not found]`, and the
// remaining files should still be processed.
//
// **Validates: Requirements 3.3**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { FileReader } from "../../files/reader.js";
import { SessionRegistry } from "../../session/registry.js";
import { PathValidator } from "../../security/path_validator.js";
import type { FileReadResult } from "../../types.js";

const SESSION_ID = "test";

describe("Property 6: Missing file error marker", () => {
  it("formatForPayload includes [ERROR: file not found] for missing paths", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 100 }),
          { minLength: 1, maxLength: 20 }
        ),
        (paths) => {
          const registry = new SessionRegistry();
          const pathValidator = new PathValidator(["/allowed"], registry);
          const reader = new FileReader(pathValidator, SESSION_ID);

          const results: FileReadResult[] = paths.map((p) => ({
            path: p,
            content: null,
            error: "file not found",
            tokenEstimate: 0,
          }));

          const payload = reader.formatForPayload(results);

          for (const p of paths) {
            expect(payload).toContain(`### File: ${p}\n[ERROR: file not found]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("remaining files are still processed when some are missing", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.string({ minLength: 1, maxLength: 80 }),
            content: fc.string({ maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.array(
          fc.string({ minLength: 1, maxLength: 80 }),
          { minLength: 1, maxLength: 10 }
        ),
        (existingPairs, missingPaths) => {
          const registry = new SessionRegistry();
          const pathValidator = new PathValidator(["/allowed"], registry);
          const reader = new FileReader(pathValidator, SESSION_ID);

          const existingResults: FileReadResult[] = existingPairs.map(({ path, content }) => ({
            path,
            content,
            error: undefined,
            tokenEstimate: Math.floor(content.length / 4),
          }));

          const missingResults: FileReadResult[] = missingPaths.map((p) => ({
            path: p,
            content: null,
            error: "file not found",
            tokenEstimate: 0,
          }));

          // Interleave existing and missing
          const allResults = [...existingResults, ...missingResults];
          const payload = reader.formatForPayload(allResults);

          // All existing files must appear
          for (const { path, content } of existingPairs) {
            expect(payload).toContain(`### File: ${path}\n${content}`);
          }

          // All missing files must have the error marker
          for (const p of missingPaths) {
            expect(payload).toContain(`### File: ${p}\n[ERROR: file not found]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
