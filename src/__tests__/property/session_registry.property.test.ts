// Feature: dynamic-allowed-dirs, Property 3: idempotent union
// For any session and any list of paths, calling addDirs with the same paths
// multiple times SHALL produce the same Dynamic_Dirs as calling it once — no
// duplicates are introduced.
//
// **Validates: Requirements 1.3**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SessionRegistry } from "../../session/registry.js";

describe("Property 3: declare_working_dirs is idempotent (union semantics)", () => {
  it("calling addDirs multiple times with the same paths produces the same result as calling once", () => {
    fc.assert(
      fc.property(
        // Generate a session ID
        fc.string({ minLength: 1, maxLength: 20 }),
        // Generate a list of directory paths (1-10 paths)
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/test/dir/${s}`),
          { minLength: 1, maxLength: 10 }
        ),
        // Generate number of times to call addDirs (2-5 times)
        fc.integer({ min: 2, max: 5 }),
        (sessionId, paths, callCount) => {
          // Test calling addDirs once
          const registrySingle = new SessionRegistry();
          const resultSingle = registrySingle.addDirs(sessionId, paths);

          // Test calling addDirs multiple times with the same paths
          const registryMultiple = new SessionRegistry();
          let resultMultiple: string[] = [];
          for (let i = 0; i < callCount; i++) {
            resultMultiple = registryMultiple.addDirs(sessionId, paths);
          }

          // Both should produce the same result
          expect(resultMultiple).toEqual(resultSingle);

          // Verify no duplicates in either result
          expect(resultSingle.length).toBe(new Set(resultSingle).size);
          expect(resultMultiple.length).toBe(new Set(resultMultiple).size);

          // Verify getDynamicDirs returns the same for both
          expect(registryMultiple.getDynamicDirs(sessionId)).toEqual(
            registrySingle.getDynamicDirs(sessionId)
          );

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("calling addDirs with overlapping path sets produces union without duplicates", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        // Generate two sets of paths with potential overlap
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/test/dir/${s}`),
          { minLength: 1, maxLength: 5 }
        ),
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/test/dir/${s}`),
          { minLength: 1, maxLength: 5 }
        ),
        (sessionId, paths1, paths2) => {
          const registry = new SessionRegistry();

          // Add first set
          const result1 = registry.addDirs(sessionId, paths1);

          // Add second set (may overlap with first)
          const result2 = registry.addDirs(sessionId, paths2);

          // Add both sets again (should be idempotent)
          const result3 = registry.addDirs(sessionId, [...paths1, ...paths2]);

          // Result should be the union of both sets
          const expectedUnion = Array.from(new Set([...paths1, ...paths2]));

          // Final result should match the union
          expect(result3.sort()).toEqual(expectedUnion.sort());

          // No duplicates in any result
          expect(result1.length).toBe(new Set(result1).size);
          expect(result2.length).toBe(new Set(result2).size);
          expect(result3.length).toBe(new Set(result3).size);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("addDirs with empty array is idempotent and preserves existing dirs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/test/dir/${s}`),
          { minLength: 1, maxLength: 10 }
        ),
        fc.integer({ min: 1, max: 5 }),
        (sessionId, initialPaths, emptyCallCount) => {
          const registry = new SessionRegistry();

          // Add initial paths
          const initialResult = registry.addDirs(sessionId, initialPaths);

          // Call addDirs with empty array multiple times
          let currentResult = initialResult;
          for (let i = 0; i < emptyCallCount; i++) {
            currentResult = registry.addDirs(sessionId, []);
          }

          // Result should be unchanged
          expect(currentResult).toEqual(initialResult);
          expect(registry.getDynamicDirs(sessionId)).toEqual(initialResult);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 5: session isolation", () => {
  // Feature: dynamic-allowed-dirs, Property 5: session isolation
  // For any two distinct session IDs, adding Dynamic_Dirs to one session SHALL
  // NOT affect the Dynamic_Dirs of the other session.
  //
  // **Validates: Requirements 3.3**

  it("adding dirs to one session does not affect another session", () => {
    fc.assert(
      fc.property(
        // Generate two distinct session IDs
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        // Generate paths for session A
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/session/a/${s}`),
          { minLength: 1, maxLength: 10 }
        ),
        // Generate paths for session B
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/session/b/${s}`),
          { minLength: 1, maxLength: 10 }
        ),
        (sessionIdA, sessionIdB, pathsA, pathsB) => {
          // Ensure session IDs are distinct
          fc.pre(sessionIdA !== sessionIdB);

          const registry = new SessionRegistry();

          // Add paths to session A
          const resultA = registry.addDirs(sessionIdA, pathsA);

          // Verify session B is still empty
          expect(registry.getDynamicDirs(sessionIdB)).toEqual([]);

          // Add paths to session B
          const resultB = registry.addDirs(sessionIdB, pathsB);

          // Verify session A is unchanged
          expect(registry.getDynamicDirs(sessionIdA)).toEqual(resultA);

          // Verify session B has only its own paths
          expect(registry.getDynamicDirs(sessionIdB)).toEqual(resultB);

          // Verify the two sessions have independent state
          expect(resultA).not.toEqual(resultB);

          // Add more paths to session A
          const additionalPathsA = pathsA.map((p) => `${p}/extra`);
          const resultA2 = registry.addDirs(sessionIdA, additionalPathsA);

          // Verify session B is still unchanged
          expect(registry.getDynamicDirs(sessionIdB)).toEqual(resultB);

          // Verify session A has the merged paths
          const expectedA = Array.from(new Set([...pathsA, ...additionalPathsA]));
          expect(resultA2.sort()).toEqual(expectedA.sort());

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("clearing one session does not affect another session", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/session/a/${s}`),
          { minLength: 1, maxLength: 10 }
        ),
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/session/b/${s}`),
          { minLength: 1, maxLength: 10 }
        ),
        (sessionIdA, sessionIdB, pathsA, pathsB) => {
          // Ensure session IDs are distinct
          fc.pre(sessionIdA !== sessionIdB);

          const registry = new SessionRegistry();

          // Add paths to both sessions
          const resultA = registry.addDirs(sessionIdA, pathsA);
          const resultB = registry.addDirs(sessionIdB, pathsB);

          // Clear session A
          registry.clearSession(sessionIdA);

          // Verify session A is now empty
          expect(registry.getDynamicDirs(sessionIdA)).toEqual([]);

          // Verify session B is unchanged
          expect(registry.getDynamicDirs(sessionIdB)).toEqual(resultB);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("multiple sessions can have overlapping paths without interference", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/shared/${s}`),
          { minLength: 1, maxLength: 5 }
        ),
        (sessionIdA, sessionIdB, sessionIdC, sharedPaths) => {
          // Ensure all session IDs are distinct
          fc.pre(
            sessionIdA !== sessionIdB &&
              sessionIdB !== sessionIdC &&
              sessionIdA !== sessionIdC
          );

          const registry = new SessionRegistry();

          // Add the same paths to all three sessions
          const resultA = registry.addDirs(sessionIdA, sharedPaths);
          const resultB = registry.addDirs(sessionIdB, sharedPaths);
          const resultC = registry.addDirs(sessionIdC, sharedPaths);

          // All sessions should have the same paths
          expect(resultA.sort()).toEqual(sharedPaths.sort());
          expect(resultB.sort()).toEqual(sharedPaths.sort());
          expect(resultC.sort()).toEqual(sharedPaths.sort());

          // Add unique paths to session A
          const uniquePathsA = sharedPaths.map((p) => `${p}/unique-a`);
          const resultA2 = registry.addDirs(sessionIdA, uniquePathsA);

          // Verify session A has both shared and unique paths
          const expectedA = Array.from(new Set([...sharedPaths, ...uniquePathsA]));
          expect(resultA2.sort()).toEqual(expectedA.sort());

          // Verify sessions B and C still have only shared paths
          expect(registry.getDynamicDirs(sessionIdB).sort()).toEqual(
            sharedPaths.sort()
          );
          expect(registry.getDynamicDirs(sessionIdC).sort()).toEqual(
            sharedPaths.sort()
          );

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
