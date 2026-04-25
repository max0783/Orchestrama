/**
 * Unit tests for declare_working_dirs tool handler.
 *
 * Tests specific examples and edge cases for path validation, security policy,
 * and response format.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createDeclareWorkingDirsHandler } from "../../tools/declare_working_dirs.js";
import { SessionRegistry } from "../../session/registry.js";
import type { BridgeConfig } from "../../types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("declare_working_dirs handler", () => {
  let registry: SessionRegistry;
  let tempDir: string;

  beforeEach(async () => {
    registry = new SessionRegistry();
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "declare-test-"));
  });

  // Helper to extract JSON from response text
  function extractJson(text: string): any {
    // Find the JSON object in the response
    // The format is: "Working directories declared\n\n{...}\n\n✓ Accepted..."
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Could not find JSON in response: ${text}`);
    }
    return JSON.parse(jsonMatch[0]);
  }

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------

  it("rejects non-object arguments", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    await expect(handler("not an object")).rejects.toThrow("Arguments must be an object");
  });

  it("rejects missing paths field", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    await expect(handler({})).rejects.toThrow('"paths" must be an array');
  });

  it("rejects non-string path elements", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    await expect(handler({ paths: [123, "valid"] })).rejects.toThrow(
      '"paths[0]" must be a string'
    );
  });

  // ---------------------------------------------------------------------------
  // Path validation
  // ---------------------------------------------------------------------------

  it("accepts an existing directory when allowedDirsExplicit=false", async () => {
    const config: BridgeConfig = {
      allowedDirs: [process.cwd()],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const result = await handler({ paths: [tempDir] });
    const content = result.content[0];
    expect(content.type).toBe("text");

    const parsed = extractJson(content.text);
    expect(parsed.accepted).toContain(tempDir);
    expect(parsed.rejected).toHaveLength(0);
  });

  it("rejects a non-existent path", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const nonExistent = path.join(tempDir, "does-not-exist");
    const result = await handler({ paths: [nonExistent] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed.accepted).toHaveLength(0);
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0].path).toBe(nonExistent);
    expect(parsed.rejected[0].reason).toContain("path does not exist");
  });

  it("rejects a file (not a directory)", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    // Create a file
    const filePath = path.join(tempDir, "test-file.txt");
    await fs.writeFile(filePath, "test content");

    const result = await handler({ paths: [filePath] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed.accepted).toHaveLength(0);
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0].path).toBe(filePath);
    expect(parsed.rejected[0].reason).toContain("path is not a directory");
  });

  it("accepts path outside static dirs when allowedDirsExplicit=true", async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));

    const config: BridgeConfig = {
      allowedDirs: [staticDir],
      allowedDirsExplicit: true,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const result = await handler({ paths: [outsideDir] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed.accepted).toContain(outsideDir);
    expect(parsed.rejected).toHaveLength(0);
    expect(parsed.dynamic_dirs).toContain(outsideDir);
    expect(parsed.effective_dirs).toContain(outsideDir);
  });

  it("accepts subdirectory of static dir when allowedDirsExplicit=true", async () => {
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-"));
    const subDir = path.join(staticDir, "subdir");
    await fs.mkdir(subDir);

    const config: BridgeConfig = {
      allowedDirs: [staticDir],
      allowedDirsExplicit: true,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const result = await handler({ paths: [subDir] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed.accepted).toContain(subDir);
    expect(parsed.rejected).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Partial success
  // ---------------------------------------------------------------------------

  it("supports partial success (mixed valid/invalid paths)", async () => {
    const validDir = await fs.mkdtemp(path.join(os.tmpdir(), "valid-"));
    const invalidPath = path.join(tempDir, "does-not-exist");

    const config: BridgeConfig = {
      allowedDirs: [process.cwd()],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const result = await handler({ paths: [validDir, invalidPath] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed.accepted).toContain(validDir);
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0].path).toBe(invalidPath);
  });

  // ---------------------------------------------------------------------------
  // Response format
  // ---------------------------------------------------------------------------

  it("returns correct response structure", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const result = await handler({ paths: [tempDir] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed).toHaveProperty("accepted");
    expect(parsed).toHaveProperty("rejected");
    expect(parsed).toHaveProperty("static_dirs");
    expect(parsed).toHaveProperty("dynamic_dirs");
    expect(parsed).toHaveProperty("effective_dirs");

    expect(Array.isArray(parsed.accepted)).toBe(true);
    expect(Array.isArray(parsed.rejected)).toBe(true);
    expect(Array.isArray(parsed.static_dirs)).toBe(true);
    expect(Array.isArray(parsed.dynamic_dirs)).toBe(true);
    expect(Array.isArray(parsed.effective_dirs)).toBe(true);
  });

  it("updates session registry with accepted paths", async () => {
    const config: BridgeConfig = {
      allowedDirs: [process.cwd()],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    await handler({ paths: [tempDir] });

    const dynamicDirs = registry.getDynamicDirs("test");
    expect(dynamicDirs).toContain(tempDir);
  });

  it("returns empty accepted list when no paths are valid", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const result = await handler({ paths: [path.join(tempDir, "nonexistent")] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed.accepted).toHaveLength(0);
    expect(parsed.rejected).toHaveLength(1);
  });

  it("handles empty paths array", async () => {
    const config: BridgeConfig = {
      allowedDirs: [tempDir],
      allowedDirsExplicit: false,
    } as BridgeConfig;

    const handler = createDeclareWorkingDirsHandler({
      config,
      registry,
      sessionId: "test",
    });

    const result = await handler({ paths: [] });
    const content = result.content[0];
    const parsed = extractJson(content.text);

    expect(parsed.accepted).toHaveLength(0);
    expect(parsed.rejected).toHaveLength(0);
    expect(parsed.static_dirs).toEqual([tempDir]);
    expect(parsed.dynamic_dirs).toHaveLength(0);
  });
});
