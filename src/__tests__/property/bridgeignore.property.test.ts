// Feature: ollama-mcp-bridge, Property 17: .bridgeignore pattern exclusion
// For any set of file paths and a `.bridgeignore` file containing glob patterns,
// every file whose path matches at least one pattern should be absent from the
// file reader output.
//
// **Validates: Requirements 16.2, 16.3**

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FileReader, loadIgnoreRules } from "../../files/reader.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridgeignore-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Property 17: .bridgeignore pattern exclusion", () => {
  it("files matching .bridgeignore patterns are excluded from readContextFiles output", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a list of simple filenames (no path separators)
        fc.array(
          fc.stringMatching(/^[a-z][a-z0-9]{0,10}\.(txt|log|ts|js)$/).filter((s) => s.length > 0),
          { minLength: 2, maxLength: 8 }
        ),
        async (filenames) => {
          // Deduplicate filenames
          const uniqueFilenames = [...new Set(filenames)];
          if (uniqueFilenames.length < 2) return;

          // Split into "ignored" and "kept" groups
          const ignoredFiles = uniqueFilenames.slice(0, Math.ceil(uniqueFilenames.length / 2));
          const keptFiles = uniqueFilenames.slice(Math.ceil(uniqueFilenames.length / 2));

          // Create all files in tmpDir
          for (const name of uniqueFilenames) {
            await fs.writeFile(path.join(tmpDir, name), `content of ${name}`);
          }

          // Write .bridgeignore with patterns for the ignored files
          const patterns = ignoredFiles.join("\n");
          await fs.writeFile(path.join(tmpDir, ".bridgeignore"), patterns);

          // Load ignore rules and read files
          const ignoreRules = await loadIgnoreRules(tmpDir);
          const reader = new FileReader([tmpDir]);
          const allPaths = uniqueFilenames.map((n) => path.join(tmpDir, n));
          const results = await reader.readContextFiles(allPaths, ignoreRules);

          // Files matching .bridgeignore patterns must not appear with content
          for (const name of ignoredFiles) {
            const result = results.find((r) => r.path === path.join(tmpDir, name));
            if (result) {
              // If present, it must not have content (excluded by ignore rules)
              expect(result.content).toBeNull();
            }
            // Or it may simply not be in the results at all
          }

          // Kept files should have content
          for (const name of keptFiles) {
            const result = results.find((r) => r.path === path.join(tmpDir, name));
            if (result) {
              expect(result.content).toBe(`content of ${name}`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("loadIgnoreRules includes default patterns regardless of .bridgeignore", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 100 }),
        async (extraContent) => {
          // Write a .bridgeignore with arbitrary extra content
          await fs.writeFile(path.join(tmpDir, ".bridgeignore"), extraContent);

          const ig = await loadIgnoreRules(tmpDir);

          // Default patterns must always be active
          expect(ig.ignores("node_modules/")).toBe(true);
          expect(ig.ignores(".git/")).toBe(true);
          expect(ig.ignores("dist/")).toBe(true);
          expect(ig.ignores("something.png")).toBe(true);
          expect(ig.ignores("archive.zip")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
