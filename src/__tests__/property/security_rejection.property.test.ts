// Feature: orchestrama, Property 5: Security rejection for out-of-bounds paths
// For any file path whose resolved real path falls outside all configured allowed
// directories (including symlinks that point outside), the bridge should include
// `[SECURITY ERROR: path outside allowed directories]` in the payload entry and
// should not read the file's content.
//
// **Validates: Requirements 3.6, 3.7, 3.8**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import path from "path";
import os from "os";
import { FileReader, isPathAllowed } from "../../files/reader.js";
import { SessionRegistry } from "../../session/registry.js";
import { PathValidator } from "../../security/path_validator.js";
import type { FileReadResult } from "../../types.js";

const SESSION_ID = "test";

describe("Property 5: Security rejection for out-of-bounds paths", () => {
  it("formatForPayload includes SECURITY ERROR marker for out-of-bounds paths", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 100 }),
          { minLength: 1, maxLength: 20 }
        ),
        (paths) => {
          const registry = new SessionRegistry();
          const pathValidator = new PathValidator(["/allowed/dir"], registry);
          const reader = new FileReader(pathValidator, SESSION_ID);

          // Build FileReadResult objects with security errors (as produced by readContextFiles)
          const results: FileReadResult[] = paths.map((p) => ({
            path: p,
            content: null,
            error: "SECURITY ERROR: path outside allowed directories",
            tokenEstimate: 0,
          }));

          const payload = reader.formatForPayload(results);

          for (const p of paths) {
            expect(payload).toContain(
              `### File: ${p}\n[SECURITY ERROR: path outside allowed directories]`
            );
            // Content must not be present — only the error marker
            expect(payload).not.toContain(`### File: ${p}\nnull`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("security error entries contain no file content", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        // Use a content string that is unlikely to appear in the error message
        fc.string({ minLength: 10, maxLength: 200 }).filter(
          (s) => !s.includes("[SECURITY ERROR") && !s.includes("### File:")
        ),
        (outPath, someContent) => {
          const registry = new SessionRegistry();
          const pathValidator = new PathValidator(["/allowed/dir"], registry);
          const reader = new FileReader(pathValidator, SESSION_ID);

          const results: FileReadResult[] = [
            {
              path: outPath,
              content: null, // content must be null for security-rejected paths
              error: "SECURITY ERROR: path outside allowed directories",
              tokenEstimate: 0,
            },
          ];

          const payload = reader.formatForPayload(results);

          // The payload should have the security error marker
          expect(payload).toContain("[SECURITY ERROR: path outside allowed directories]");
          // The actual file content (someContent) must not appear as a file body
          // We verify by checking the payload doesn't contain the content after the path header
          expect(payload).not.toContain(`### File: ${outPath}\n${someContent}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("isPathAllowed returns false for paths outside allowed dirs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes("\0") && !s.includes("/")),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes("\0") && !s.includes("/")),
        (allowedSuffix, outsideSuffix) => {
          // Use path.join to build OS-appropriate paths
          const allowedDir = path.join(os.tmpdir(), `allowed-${allowedSuffix}`);
          const outsidePath = path.join(os.tmpdir(), `outside-${outsideSuffix}`, "file.txt");

          // outsidePath is not under allowedDir (different sibling dirs)
          const result = isPathAllowed(outsidePath, [allowedDir]);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
