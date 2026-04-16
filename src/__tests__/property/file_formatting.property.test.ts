// Feature: ollama-mcp-bridge, Property 4: File payload formatting
// For any list of (path, content) pairs where the files exist and are within
// allowed directories, `formatForPayload` should produce a string that contains
// the substring `### File: {path}\n{content}` for every entry in the list.
//
// **Validates: Requirements 3.1, 3.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { FileReader } from "../../files/reader.js";
import type { FileReadResult } from "../../types.js";

describe("Property 4: File payload formatting", () => {
  it("formatForPayload contains ### File: {path}\\n{content} for every successful entry", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.string({ minLength: 1, maxLength: 100 }),
            content: fc.string({ maxLength: 500 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (pairs) => {
          const reader = new FileReader(["/allowed"]);
          const results: FileReadResult[] = pairs.map(({ path, content }) => ({
            path,
            content,
            error: undefined,
            tokenEstimate: Math.floor(content.length / 4),
          }));

          const payload = reader.formatForPayload(results);

          for (const { path, content } of pairs) {
            expect(payload).toContain(`### File: ${path}\n${content}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formatForPayload includes all entries even when mixed with errors", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.string({ minLength: 1, maxLength: 100 }),
            content: fc.string({ maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (pairs) => {
          const reader = new FileReader(["/allowed"]);
          const results: FileReadResult[] = pairs.map(({ path, content }) => ({
            path,
            content,
            error: undefined,
            tokenEstimate: Math.floor(content.length / 4),
          }));

          const payload = reader.formatForPayload(results);

          // Every successful entry must appear in the payload
          for (const { path, content } of pairs) {
            const expected = `### File: ${path}\n${content}`;
            expect(payload).toContain(expected);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
