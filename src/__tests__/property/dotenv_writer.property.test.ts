// Feature: interactive-console-ui, Property 8: DotEnv round-trip
// Feature: interactive-console-ui, Property 9: DotEnv merge preservation

/**
 * Property-based tests for src/console/dotenv_writer.ts
 *
 * Property 8: DotEnv round-trip
 *   Validates: Requirements 5.6, 5.7, 5.9
 *
 * Property 9: DotEnv merge preservation
 *   Validates: Requirements 5.4
 */

import { describe, it, afterEach } from "vitest";
import * as fc from "fast-check";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { writeEnvKeys, parseEnvContent } from "../../console/dotenv_writer.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Valid env-var names: uppercase letter followed by up to 29 uppercase letters, digits, or underscores */
const envVarNameArb = fc
  .stringMatching(/^[A-Z][A-Z0-9_]{0,29}$/)
  .filter((s) => s.length > 0);

/** Arbitrary string values — no null bytes (which can't appear in env files) */
const envVarValueArb = fc
  .string({ minLength: 0, maxLength: 100 })
  .filter((s) => !s.includes("\0"));

/** A record of 1–10 env-var key-value pairs */
const envRecordArb = fc.dictionary(envVarNameArb, envVarValueArb, {
  minKeys: 1,
  maxKeys: 10,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh temp directory for each test run; caller is responsible for cleanup. */
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dotenv-prop-test-"));
}

// ---------------------------------------------------------------------------
// Property 8: DotEnv round-trip
// ---------------------------------------------------------------------------

describe("Property 8: DotEnv round-trip", () => {
  // **Validates: Requirements 5.6, 5.7, 5.9**
  it(
    "writing key-value pairs with writeEnvKeys and parsing the result recovers all original pairs exactly",
    async () => {
      const tmpDirs: string[] = [];

      await fc.assert(
        fc.asyncProperty(envRecordArb, async (record) => {
          const tmpDir = await makeTmpDir();
          tmpDirs.push(tmpDir);
          const filePath = path.join(tmpDir, ".env");

          // Write the record to a fresh .env file
          await writeEnvKeys(record, filePath);

          // Read back and parse
          const written = await fs.readFile(filePath, "utf8");
          const parsed = parseEnvContent(written);

          // Every key-value pair in the original record must be recovered exactly
          for (const [key, value] of Object.entries(record)) {
            if (parsed.get(key) !== value) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: 100 }
      );

      // Cleanup all temp dirs
      for (const dir of tmpDirs) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  );
});

// ---------------------------------------------------------------------------
// Property 9: DotEnv merge preservation
// ---------------------------------------------------------------------------

describe("Property 9: DotEnv merge preservation", () => {
  // **Validates: Requirements 5.4**
  it(
    "keys not included in the update set retain their original values after writeEnvKeys",
    async () => {
      const tmpDirs: string[] = [];

      await fc.assert(
        fc.asyncProperty(
          // Generate an initial set of key-value pairs (the "existing" content)
          envRecordArb,
          // Generate a second record whose keys will be used as the "update" set
          envRecordArb,
          async (initialRecord, updateRecord) => {
            const tmpDir = await makeTmpDir();
            tmpDirs.push(tmpDir);
            const filePath = path.join(tmpDir, ".env");

            // Write the initial content
            await writeEnvKeys(initialRecord, filePath);

            // Apply the update (only keys in updateRecord are changed)
            await writeEnvKeys(updateRecord, filePath);

            // Read back and parse
            const written = await fs.readFile(filePath, "utf8");
            const parsed = parseEnvContent(written);

            // All keys from the initial record that are NOT in the update set
            // must still have their original values
            for (const [key, originalValue] of Object.entries(initialRecord)) {
              if (key in updateRecord) {
                // This key was updated — skip it
                continue;
              }
              if (parsed.get(key) !== originalValue) {
                return false;
              }
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );

      // Cleanup all temp dirs
      for (const dir of tmpDirs) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  );
});
