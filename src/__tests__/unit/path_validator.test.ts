import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { PathValidator } from "../../security/path_validator.js";
import { SessionRegistry } from "../../session/registry.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

describe("PathValidator", () => {
  let registry: SessionRegistry;
  let validator: PathValidator;
  const sessionId = "test-session";

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  describe("getEffectiveDirs", () => {
    it("returns only static dirs when no dynamic dirs are registered", () => {
      const staticDirs = ["/static/dir1", "/static/dir2"];
      validator = new PathValidator(staticDirs, registry);

      const effective = validator.getEffectiveDirs(sessionId);

      expect(effective).toEqual(staticDirs);
    });

    it("returns union of static and dynamic dirs", () => {
      const staticDirs = ["/static/dir1"];
      validator = new PathValidator(staticDirs, registry);
      registry.addDirs(sessionId, ["/dynamic/dir1", "/dynamic/dir2"]);

      const effective = validator.getEffectiveDirs(sessionId);

      expect(effective).toEqual(["/static/dir1", "/dynamic/dir1", "/dynamic/dir2"]);
    });

    it("removes duplicates when static and dynamic overlap", () => {
      const staticDirs = ["/shared/dir", "/static/dir"];
      validator = new PathValidator(staticDirs, registry);
      registry.addDirs(sessionId, ["/shared/dir", "/dynamic/dir"]);

      const effective = validator.getEffectiveDirs(sessionId);

      expect(effective).toEqual(["/shared/dir", "/static/dir", "/dynamic/dir"]);
    });

    it("preserves order: static first, then dynamic", () => {
      const staticDirs = ["/static/a", "/static/b"];
      validator = new PathValidator(staticDirs, registry);
      registry.addDirs(sessionId, ["/dynamic/c", "/dynamic/d"]);

      const effective = validator.getEffectiveDirs(sessionId);

      expect(effective).toEqual(["/static/a", "/static/b", "/dynamic/c", "/dynamic/d"]);
    });
  });

  describe("isAllowed", () => {
    it("returns true for path equal to allowed dir", () => {
      const staticDirs = ["/allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(validator.isAllowed("/allowed", sessionId)).toBe(true);
    });

    it("returns true for path within allowed dir", () => {
      const staticDirs = ["/allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(validator.isAllowed(`/allowed${path.sep}subdir`, sessionId)).toBe(true);
      expect(validator.isAllowed(`/allowed${path.sep}subdir${path.sep}file.txt`, sessionId)).toBe(true);
    });

    it("returns false for path outside allowed dirs", () => {
      const staticDirs = ["/allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(validator.isAllowed("/forbidden", sessionId)).toBe(false);
      expect(validator.isAllowed("/forbidden/subdir", sessionId)).toBe(false);
    });

    it("returns false for path that is a prefix of allowed dir but not within it", () => {
      const staticDirs = ["/allowed"];
      validator = new PathValidator(staticDirs, registry);

      // "/allowed-but-not-really" starts with "/allowed" but is not within it
      expect(validator.isAllowed("/allowed-but-not-really", sessionId)).toBe(false);
    });

    it("checks against dynamic dirs as well as static dirs", () => {
      const staticDirs = [path.join("/", "static")];
      validator = new PathValidator(staticDirs, registry);
      registry.addDirs(sessionId, [path.join("/", "dynamic")]);

      expect(validator.isAllowed(path.join("/", "static", "file.txt"), sessionId)).toBe(true);
      expect(validator.isAllowed(path.join("/", "dynamic", "file.txt"), sessionId)).toBe(true);
      expect(validator.isAllowed(path.join("/", "other", "file.txt"), sessionId)).toBe(false);
    });

    it("handles paths with trailing separators correctly", () => {
      const staticDirs = ["/allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(validator.isAllowed(`/allowed${path.sep}`, sessionId)).toBe(true);
    });

    it("is case-insensitive on Windows", () => {
      if (process.platform !== "win32") {
        // Skip this test on non-Windows platforms
        return;
      }

      const staticDirs = ["C:\\Allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(validator.isAllowed("c:\\allowed\\file.txt", sessionId)).toBe(true);
      expect(validator.isAllowed("C:\\ALLOWED\\FILE.TXT", sessionId)).toBe(true);
    });

    it("is case-sensitive on POSIX", () => {
      if (process.platform === "win32") {
        // Skip this test on Windows
        return;
      }

      const staticDirs = ["/Allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(validator.isAllowed("/Allowed/file.txt", sessionId)).toBe(true);
      expect(validator.isAllowed("/allowed/file.txt", sessionId)).toBe(false);
      expect(validator.isAllowed("/ALLOWED/file.txt", sessionId)).toBe(false);
    });
  });

  describe("assertCwdAllowed", () => {
    it("does not throw for allowed cwd", () => {
      const staticDirs = ["/allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(() => validator.assertCwdAllowed("/allowed", sessionId)).not.toThrow();
      expect(() => validator.assertCwdAllowed(`/allowed${path.sep}subdir`, sessionId)).not.toThrow();
    });

    it("throws McpError for disallowed cwd", () => {
      const staticDirs = ["/allowed"];
      validator = new PathValidator(staticDirs, registry);

      expect(() => validator.assertCwdAllowed("/forbidden", sessionId)).toThrow(McpError);
      
      try {
        validator.assertCwdAllowed("/forbidden", sessionId);
      } catch (error) {
        expect(error).toBeInstanceOf(McpError);
        expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
        expect((error as McpError).message).toContain('SECURITY: cwd "/forbidden" is outside allowed directories');
        expect((error as McpError).message).toContain("Effective dirs: /allowed");
      }
    });

    it("includes effective dirs in error message", () => {
      const staticDirs = ["/static"];
      validator = new PathValidator(staticDirs, registry);
      registry.addDirs(sessionId, ["/dynamic"]);

      try {
        validator.assertCwdAllowed("/forbidden", sessionId);
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as McpError).message).toContain("/static");
        expect((error as McpError).message).toContain("/dynamic");
      }
    });
  });
});
