// Feature: dynamic-allowed-dirs, Property 4: Path validation uses effective dirs
// For any session where Dynamic_Dirs have been declared, a path that is a subdirectory
// of a Dynamic_Dir SHALL be accepted by PathValidator.isAllowed, and a path outside
// all Effective_Dirs SHALL be rejected.
//
// **Validates: Requirements 3.1, 3.2**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import path from "path";
import { PathValidator } from "../../security/path_validator.js";
import { SessionRegistry } from "../../session/registry.js";

describe("Property 4: Path validation uses effective dirs", () => {
  it("paths within effective dirs are allowed", () => {
    fc.assert(
      fc.property(
        // Generate a base directory and a subdirectory within it
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `/allowed/${s}`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `subdir/${s}`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (allowedDir, subPath, sessionId) => {
          const registry = new SessionRegistry();
          const validator = new PathValidator([allowedDir], registry);

          // Test path equal to allowed dir
          expect(validator.isAllowed(allowedDir, sessionId)).toBe(true);

          // Test path within allowed dir
          const subdir = `${allowedDir}${path.sep}${subPath}`;
          expect(validator.isAllowed(subdir, sessionId)).toBe(true);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("paths outside all effective dirs are rejected", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => `/allowed/${s}`), { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `/forbidden/${s}`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (allowedDirs, forbiddenPath, sessionId) => {
          const registry = new SessionRegistry();
          const validator = new PathValidator(allowedDirs, registry);

          // Ensure forbidden path is not a subdirectory of any allowed dir
          const isActuallyForbidden = !allowedDirs.some(dir => 
            forbiddenPath === dir || forbiddenPath.startsWith(dir + path.sep)
          );

          if (isActuallyForbidden) {
            expect(validator.isAllowed(forbiddenPath, sessionId)).toBe(false);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("paths within dynamic dirs are allowed", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `/static/${s}`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `/dynamic/${s}`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `subdir/${s}`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (staticDir, dynamicDir, subPath, sessionId) => {
          const registry = new SessionRegistry();
          const validator = new PathValidator([staticDir], registry);

          // Add dynamic dir
          registry.addDirs(sessionId, [dynamicDir]);

          // Path within static dir should be allowed
          const staticSubdir = `${staticDir}${path.sep}${subPath}`;
          expect(validator.isAllowed(staticSubdir, sessionId)).toBe(true);

          // Path within dynamic dir should be allowed
          const dynamicSubdir = `${dynamicDir}${path.sep}${subPath}`;
          expect(validator.isAllowed(dynamicSubdir, sessionId)).toBe(true);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("isAllowed is consistent with getEffectiveDirs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => `/static/${s}`), { maxLength: 5 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).map(s => `/dynamic/${s}`), { maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (staticDirs, dynamicDirs, sessionId) => {
          const registry = new SessionRegistry();
          const validator = new PathValidator(staticDirs, registry);

          if (dynamicDirs.length > 0) {
            registry.addDirs(sessionId, dynamicDirs);
          }

          const effectiveDirs = validator.getEffectiveDirs(sessionId);

          // For each effective dir, the dir itself and subdirs should be allowed
          for (const dir of effectiveDirs) {
            expect(validator.isAllowed(dir, sessionId)).toBe(true);
            expect(validator.isAllowed(`${dir}${path.sep}subdir`, sessionId)).toBe(true);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
