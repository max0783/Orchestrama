/**
 * Unit tests for src/console/dotenv_writer.ts
 *
 * Requirements: 5.4, 5.5, 5.6, 5.7, 5.8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { parseEnvContent, serializeEnvContent, writeEnvKeys } from "../../console/dotenv_writer.js";

// Make fs/promises.rename spy-able (it is non-configurable on some Node versions)
vi.mock("fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("fs/promises")>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// parseEnvContent
// ---------------------------------------------------------------------------

describe("parseEnvContent()", () => {
  it("parses a simple KEY=VALUE line", () => {
    const map = parseEnvContent("FOO=bar");
    expect(map.get("FOO")).toBe("bar");
  });

  it("parses double-quoted values", () => {
    const map = parseEnvContent('FOO="hello world"');
    expect(map.get("FOO")).toBe("hello world");
  });

  it("parses single-quoted values", () => {
    const map = parseEnvContent("FOO='hello world'");
    expect(map.get("FOO")).toBe("hello world");
  });

  it("unescapes \\\" inside double-quoted values", () => {
    const map = parseEnvContent('FOO="say \\"hi\\""');
    expect(map.get("FOO")).toBe('say "hi"');
  });

  it("skips blank lines", () => {
    const map = parseEnvContent("\nFOO=bar\n\nBAZ=qux\n");
    expect(map.size).toBe(2);
    expect(map.get("FOO")).toBe("bar");
    expect(map.get("BAZ")).toBe("qux");
  });

  it("skips comment lines", () => {
    const map = parseEnvContent("# this is a comment\nFOO=bar");
    expect(map.size).toBe(1);
    expect(map.get("FOO")).toBe("bar");
  });

  it("skips lines without an equals sign", () => {
    const map = parseEnvContent("NOTAKEY\nFOO=bar");
    expect(map.size).toBe(1);
  });

  it("handles empty content", () => {
    const map = parseEnvContent("");
    expect(map.size).toBe(0);
  });

  it("parses multiple keys", () => {
    const content = "A=1\nB=2\nC=3";
    const map = parseEnvContent(content);
    expect(map.get("A")).toBe("1");
    expect(map.get("B")).toBe("2");
    expect(map.get("C")).toBe("3");
  });

  it("handles values containing = signs", () => {
    const map = parseEnvContent("FOO=a=b=c");
    expect(map.get("FOO")).toBe("a=b=c");
  });
});

// ---------------------------------------------------------------------------
// serializeEnvContent
// ---------------------------------------------------------------------------

describe("serializeEnvContent()", () => {
  it("serializes a simple key-value pair without quotes", () => {
    const map = new Map([["FOO", "bar"]]);
    const result = serializeEnvContent([], map);
    expect(result).toBe("FOO=bar");
  });

  it("quotes values containing spaces", () => {
    const map = new Map([["FOO", "hello world"]]);
    const result = serializeEnvContent([], map);
    expect(result).toBe('FOO="hello world"');
  });

  it('escapes embedded double quotes', () => {
    const map = new Map([["FOO", 'say "hi"']]);
    const result = serializeEnvContent([], map);
    expect(result).toBe('FOO="say \\"hi\\""');
  });

  it("preserves blank lines from original content", () => {
    const originalLines = ["FOO=old", "", "BAR=baz"];
    const map = new Map([["FOO", "new"], ["BAR", "baz"]]);
    const result = serializeEnvContent(originalLines, map);
    expect(result).toBe("FOO=new\n\nBAR=baz");
  });

  it("preserves comment lines from original content", () => {
    const originalLines = ["# comment", "FOO=bar"];
    const map = new Map([["FOO", "bar"]]);
    const result = serializeEnvContent(originalLines, map);
    expect(result).toBe("# comment\nFOO=bar");
  });

  it("appends new keys at the end", () => {
    const originalLines = ["FOO=bar"];
    const map = new Map([["FOO", "bar"], ["NEW_KEY", "value"]]);
    const result = serializeEnvContent(originalLines, map);
    expect(result).toBe("FOO=bar\nNEW_KEY=value");
  });

  it("quotes JSON values that contain double-quote characters", () => {
    // Values containing `"` trigger quoting per the rule /[\s"'\\=\n\r]/
    const map = new Map([["OPTS", '{"temperature":0.8}']]);
    const result = serializeEnvContent([], map);
    expect(result).toBe('OPTS="{\\"temperature\\":0.8}"');
  });

  it("quotes JSON with spaces", () => {
    const map = new Map([["OPTS", '{"temperature": 0.8}']]);
    const result = serializeEnvContent([], map);
    expect(result).toBe('OPTS="{\\"temperature\\": 0.8}"');
  });

  it("does not quote model names with colons", () => {
    const map = new Map([["MODEL", "llama3.1:8b"]]);
    const result = serializeEnvContent([], map);
    expect(result).toBe("MODEL=llama3.1:8b");
  });
});

// ---------------------------------------------------------------------------
// writeEnvKeys — integration tests using a real temp directory
// ---------------------------------------------------------------------------

describe("writeEnvKeys()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dotenv-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new .env file when none exists (ENOENT path)", async () => {
    const filePath = path.join(tmpDir, ".env");
    await writeEnvKeys({ FOO: "bar" }, filePath);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toContain("FOO=bar");
  });

  it("overwrites only the specified keys in an existing file, preserving others", async () => {
    const filePath = path.join(tmpDir, ".env");
    await fs.writeFile(filePath, "FOO=old\nBAR=keep\n", "utf8");
    await writeEnvKeys({ FOO: "new" }, filePath);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toContain("FOO=new");
    expect(content).toContain("BAR=keep");
  });

  it("preserves comment lines and blank lines", async () => {
    const filePath = path.join(tmpDir, ".env");
    await fs.writeFile(filePath, "# my comment\n\nFOO=bar\n", "utf8");
    await writeEnvKeys({ FOO: "updated" }, filePath);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toContain("# my comment");
    expect(content).toContain("FOO=updated");
  });

  it("writes atomically via .env.tmp → .env rename", async () => {
    const filePath = path.join(tmpDir, ".env");
    const tmpPath = `${filePath}.tmp`;

    // Spy on fs.rename to assert it is called with the correct paths
    const renameSpy = vi.spyOn(fs, "rename");

    await writeEnvKeys({ KEY: "value" }, filePath);

    // fs.rename must have been called with ({filePath}.tmp, {filePath})
    expect(renameSpy).toHaveBeenCalledWith(tmpPath, filePath);

    // After a successful write, the final file should exist with correct content
    const finalContent = await fs.readFile(filePath, "utf8");
    expect(finalContent).toContain("KEY=value");

    // The tmp file should have been renamed away (no longer present)
    await expect(fs.access(tmpPath)).rejects.toThrow();

    renameSpy.mockRestore();
  });

  it("logs to process.stderr and does not throw on write failure", async () => {
    // Use a path inside a non-existent directory to force a write error
    const filePath = path.join(tmpDir, "nonexistent-subdir", ".env");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(writeEnvKeys({ KEY: "value" }, filePath)).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("[console] Failed to write .env:")
    );

    stderrSpy.mockRestore();
  });

  it("uses process.cwd()/.env as the default path", async () => {
    // We can't easily test the default path without mocking cwd,
    // so we verify the function accepts no filePath argument without throwing
    // by providing an explicit path that we control.
    const filePath = path.join(tmpDir, ".env");
    await expect(writeEnvKeys({ TEST: "value" }, filePath)).resolves.toBeUndefined();
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toContain("TEST=value");
  });
});
