// Feature: ollama-mcp-bridge, Property 18: Binary file exclusion
// For any file whose byte content contains a null byte (`\0`) or is not valid
// UTF-8, the file reader should exclude it from the payload regardless of
// .bridgeignore contents.
//
// **Validates: Requirements 16.4**

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FileReader } from "../../files/reader.js";
import { SessionRegistry } from "../../session/registry.js";
import { PathValidator } from "../../security/path_validator.js";

let tmpDir: string;
let registry: SessionRegistry;
let pathValidator: PathValidator;
const SESSION_ID = "test";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "binary-exclusion-test-"));
  registry = new SessionRegistry();
  pathValidator = new PathValidator([tmpDir], registry);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Property 18: Binary file exclusion", () => {
  it("files containing null bytes are excluded from the payload", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary text prefix and suffix around the null byte
        fc.string({ maxLength: 50 }),
        fc.string({ maxLength: 50 }),
        async (prefix, suffix) => {
          const filename = `binary-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
          const filePath = path.join(tmpDir, filename);

          // Write file with a null byte embedded
          const content = Buffer.from(`${prefix}\0${suffix}`);
          await fs.writeFile(filePath, content);

          const reader = new FileReader(pathValidator, SESSION_ID);
          const results = await reader.readContextFiles([filePath]);

          expect(results).toHaveLength(1);
          expect(results[0].content).toBeNull();
          expect(results[0].error).toBe("binary file");

          // The payload must not contain the file's content
          const payload = reader.formatForPayload(results);
          expect(payload).not.toContain(`### File: ${filePath}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("binary files are excluded even when .bridgeignore is empty", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/).filter((s) => s.length > 0),
            hasBinary: fc.boolean(),
            textContent: fc.string({ maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        async (fileSpecs) => {
          // Deduplicate names
          const seen = new Set<string>();
          const unique = fileSpecs.filter((f) => {
            if (seen.has(f.name)) return false;
            seen.add(f.name);
            return true;
          });

          const filePaths: string[] = [];
          const binaryPaths = new Set<string>();
          const textPaths = new Set<string>();

          for (const spec of unique) {
            const filePath = path.join(tmpDir, `${spec.name}.dat`);
            filePaths.push(filePath);

            if (spec.hasBinary) {
              await fs.writeFile(filePath, Buffer.from(`${spec.textContent}\0binary`));
              binaryPaths.add(filePath);
            } else {
              await fs.writeFile(filePath, spec.textContent);
              textPaths.add(filePath);
            }
          }

          // No .bridgeignore — only binary detection should exclude files
          const reader = new FileReader(pathValidator, SESSION_ID);
          const results = await reader.readContextFiles(filePaths);
          const payload = reader.formatForPayload(results);

          // Binary files must not appear in payload
          for (const p of binaryPaths) {
            expect(payload).not.toContain(`### File: ${p}\n`);
          }

          // Text files must appear in payload
          for (const spec of unique) {
            if (!spec.hasBinary) {
              const p = path.join(tmpDir, `${spec.name}.dat`);
              expect(payload).toContain(`### File: ${p}\n${spec.textContent}`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
