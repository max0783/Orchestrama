// Feature: dynamic-allowed-dirs, Property 2: Effective dirs is always the union of static and dynamic dirs
// For any session with any combination of Static_Dirs and Dynamic_Dirs,
// getEffectiveDirs(sessionId) SHALL return exactly the set union of Static_Dirs
// and Dynamic_Dirs with no duplicates.
//
// **Validates: Requirements 1.4, 3.1, 3.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PathValidator } from "../../security/path_validator.js";
import { SessionRegistry } from "../../session/registry.js";

describe("Property 2: Effective dirs is always the union of static and dynamic dirs", () => {
  it("getEffectiveDirs returns exactly the set union with no duplicates", () => {
    fc.assert(
      fc.property(
        // Generate arrays of directory paths
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => `/static/${s}`), { maxLength: 10 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => `/dynamic/${s}`), { maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (staticDirs, dynamicDirs, sessionId) => {
          const registry = new SessionRegistry();
          const validator = new PathValidator(staticDirs, registry);

          // Add dynamic dirs to the session
          if (dynamicDirs.length > 0) {
            registry.addDirs(sessionId, dynamicDirs);
          }

          const effectiveDirs = validator.getEffectiveDirs(sessionId);

          // Compute expected union manually
          const expectedUnion = Array.from(new Set([...staticDirs, ...dynamicDirs]));

          // Check that effective dirs equals the expected union
          expect(effectiveDirs.sort()).toEqual(expectedUnion.sort());

          // Check no duplicates in effective dirs
          const uniqueCount = new Set(effectiveDirs).size;
          expect(effectiveDirs.length).toBe(uniqueCount);

          // Check that all static dirs are present
          for (const dir of staticDirs) {
            expect(effectiveDirs).toContain(dir);
          }

          // Check that all dynamic dirs are present
          for (const dir of dynamicDirs) {
            expect(effectiveDirs).toContain(dir);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("effective dirs contains no elements outside static and dynamic dirs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => `/static/${s}`), { maxLength: 10 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => `/dynamic/${s}`), { maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (staticDirs, dynamicDirs, sessionId) => {
          const registry = new SessionRegistry();
          const validator = new PathValidator(staticDirs, registry);

          if (dynamicDirs.length > 0) {
            registry.addDirs(sessionId, dynamicDirs);
          }

          const effectiveDirs = validator.getEffectiveDirs(sessionId);
          const allowedSet = new Set([...staticDirs, ...dynamicDirs]);

          // Every element in effective dirs must be in the union of static and dynamic
          for (const dir of effectiveDirs) {
            expect(allowedSet.has(dir)).toBe(true);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
