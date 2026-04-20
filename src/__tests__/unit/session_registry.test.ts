import { describe, it, expect, beforeEach } from "vitest";
import { SessionRegistry } from "../../session/registry.js";

describe("SessionRegistry", () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  // Test addDirs with new paths
  it("adds new directories to a session", () => {
    const result = registry.addDirs("session1", ["/path/a", "/path/b"]);
    expect(result).toEqual(["/path/a", "/path/b"]);
    expect(registry.getDynamicDirs("session1")).toEqual(["/path/a", "/path/b"]);
  });

  // Test addDirs with duplicate paths (no duplicates in result)
  it("prevents duplicate paths when adding directories", () => {
    registry.addDirs("session1", ["/path/a", "/path/b"]);
    const result = registry.addDirs("session1", ["/path/b", "/path/c"]);
    expect(result).toEqual(["/path/a", "/path/b", "/path/c"]);
    expect(registry.getDynamicDirs("session1")).toEqual(["/path/a", "/path/b", "/path/c"]);
  });

  it("prevents duplicates within a single addDirs call", () => {
    const result = registry.addDirs("session1", ["/path/a", "/path/a", "/path/b"]);
    expect(result).toEqual(["/path/a", "/path/b"]);
    expect(registry.getDynamicDirs("session1")).toEqual(["/path/a", "/path/b"]);
  });

  // Test getDynamicDirs for non-existent session returns empty array
  it("returns empty array for non-existent session", () => {
    const result = registry.getDynamicDirs("nonexistent");
    expect(result).toEqual([]);
  });

  // Test clearSession removes session data
  it("removes session data when clearSession is called", () => {
    registry.addDirs("session1", ["/path/a", "/path/b"]);
    expect(registry.getDynamicDirs("session1")).toEqual(["/path/a", "/path/b"]);
    
    registry.clearSession("session1");
    expect(registry.getDynamicDirs("session1")).toEqual([]);
  });

  it("clearSession on non-existent session does not throw", () => {
    expect(() => registry.clearSession("nonexistent")).not.toThrow();
  });

  // Additional test: multiple sessions are isolated
  it("maintains isolation between different sessions", () => {
    registry.addDirs("session1", ["/path/a"]);
    registry.addDirs("session2", ["/path/b"]);
    
    expect(registry.getDynamicDirs("session1")).toEqual(["/path/a"]);
    expect(registry.getDynamicDirs("session2")).toEqual(["/path/b"]);
    
    registry.clearSession("session1");
    expect(registry.getDynamicDirs("session1")).toEqual([]);
    expect(registry.getDynamicDirs("session2")).toEqual(["/path/b"]);
  });
});
