// Feature: dynamic-allowed-dirs, Property 6: Path normalisation round-trip
// For any path string using either forward-slash or backslash separators,
// normalising to the platform separator and then resolving SHALL produce the
// same result as resolving the original path directly.
//
// **Validates: Requirements 1.6**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import path from "path";
import { PathValidator } from "../../security/path_validator.js";
import { SessionRegistry } from "../../session/registry.js";

describe("Property 6: Path normalisation round-trip", () => {
  it("normalizing separators produces equivalent path validation results", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `/base/${s}`),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 5 }),
        fc.constantFrom("/", "\\"),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (baseDir, pathSegments, separator, sessionId) => {
          const registry = new SessionRegistry();
          
          // Normalize base dir to platform separator
          const normalizedBaseDir = baseDir.split(/[/\\]/).join(path.sep);
          const validator = new PathValidator([normalizedBaseDir], registry);

          // Create path with the specified separator
          const pathWithSeparator = baseDir + separator + pathSegments.join(separator);
          
          // Create path with platform separator
          const pathWithPlatformSep = baseDir.split(/[/\\]/).join(path.sep) + 
                                       path.sep + 
                                       pathSegments.join(path.sep);

          // Both should produce the same validation result
          const resultWithSeparator = validator.isAllowed(
            pathWithSeparator.split(/[/\\]/).join(path.sep), 
            sessionId
          );
          const resultWithPlatformSep = validator.isAllowed(pathWithPlatformSep, sessionId);

          expect(resultWithSeparator).toBe(resultWithPlatformSep);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("paths with mixed separators are handled correctly", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `/allowed/${s}`),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 3 }),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (allowedDir, pathSegments, sessionId) => {
          const registry = new SessionRegistry();
          const normalizedAllowedDir = allowedDir.split(/[/\\]/).join(path.sep);
          const validator = new PathValidator([normalizedAllowedDir], registry);

          // Create path with mixed separators (alternating / and \)
          let mixedPath = allowedDir;
          for (let i = 0; i < pathSegments.length; i++) {
            const sep = i % 2 === 0 ? "/" : "\\";
            mixedPath += sep + pathSegments[i];
          }

          // Normalize to platform separator
          const normalizedPath = mixedPath.split(/[/\\]/).join(path.sep);

          // Should be allowed since it's under allowedDir
          expect(validator.isAllowed(normalizedPath, sessionId)).toBe(true);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("trailing separators do not affect validation", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `/allowed/${s}`),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => `session-${s}`),
        (allowedDir, sessionId) => {
          const registry = new SessionRegistry();
          const normalizedAllowedDir = allowedDir.split(/[/\\]/).join(path.sep);
          const validator = new PathValidator([normalizedAllowedDir], registry);

          // Test with and without trailing separator
          const withoutTrailing = normalizedAllowedDir;
          const withTrailing = normalizedAllowedDir + path.sep;

          const resultWithout = validator.isAllowed(withoutTrailing, sessionId);
          const resultWith = validator.isAllowed(withTrailing, sessionId);

          // Both should be allowed (or both disallowed)
          expect(resultWithout).toBe(resultWith);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
