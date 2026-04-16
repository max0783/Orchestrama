/**
 * Unit tests for FileReader.
 * Tests: directory recursion depth limit, default ignore patterns,
 * symlink traversal rejection.
 * Requirements: 3.4, 3.8, 16.5
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FileReader, loadIgnoreRules, isPathAllowed } from "../../files/reader.js";
let tmpDir;
beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-reader-unit-"));
});
afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});
// ---------------------------------------------------------------------------
// isPathAllowed — use real OS paths via tmpDir
// ---------------------------------------------------------------------------
describe("isPathAllowed", () => {
    it("returns true for a path directly inside an allowed dir", () => {
        const allowed = tmpDir;
        const child = path.join(tmpDir, "file.txt");
        expect(isPathAllowed(child, [allowed])).toBe(true);
    });
    it("returns true for the allowed dir itself", () => {
        expect(isPathAllowed(tmpDir, [tmpDir])).toBe(true);
    });
    it("returns false for a path outside all allowed dirs", () => {
        const other = path.join(os.tmpdir(), "other-dir-xyz");
        expect(isPathAllowed(other, [tmpDir])).toBe(false);
    });
    it("returns false for a path that is a prefix but not a child", () => {
        // tmpDir + "2" is NOT inside tmpDir
        const sibling = tmpDir + "2";
        const child = path.join(sibling, "file.txt");
        expect(isPathAllowed(child, [tmpDir])).toBe(false);
    });
    it("returns true when path matches one of multiple allowed dirs", () => {
        const second = path.join(os.tmpdir(), "second-allowed-xyz");
        const child = path.join(second, "file.txt");
        expect(isPathAllowed(child, [tmpDir, second])).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// Directory recursion depth limit (Requirement 3.4)
// ---------------------------------------------------------------------------
describe("FileReader — directory recursion depth limit", () => {
    it("reads files at depth 1, 2, and 3 but not depth 4", async () => {
        // Create nested structure: depth1/depth2/depth3/depth4/file.txt
        const d1 = path.join(tmpDir, "d1");
        const d2 = path.join(d1, "d2");
        const d3 = path.join(d2, "d3");
        const d4 = path.join(d3, "d4");
        await fs.mkdir(d4, { recursive: true });
        await fs.writeFile(path.join(d1, "file1.txt"), "depth1");
        await fs.writeFile(path.join(d2, "file2.txt"), "depth2");
        await fs.writeFile(path.join(d3, "file3.txt"), "depth3");
        await fs.writeFile(path.join(d4, "file4.txt"), "depth4");
        const reader = new FileReader([tmpDir]);
        const results = await reader.readContextFiles([d1]);
        const paths = results.map((r) => r.path);
        // Files at depth 1, 2, 3 should be included
        expect(paths.some((p) => p.includes("file1.txt"))).toBe(true);
        expect(paths.some((p) => p.includes("file2.txt"))).toBe(true);
        expect(paths.some((p) => p.includes("file3.txt"))).toBe(true);
        // File at depth 4 should NOT be included (max depth is 3)
        expect(paths.some((p) => p.includes("file4.txt"))).toBe(false);
    });
    it("returns empty array when directory is at max depth", async () => {
        // Create a directory 3 levels deep, then try to recurse into it
        const d1 = path.join(tmpDir, "a");
        const d2 = path.join(d1, "b");
        const d3 = path.join(d2, "c");
        const d4 = path.join(d3, "d");
        await fs.mkdir(d4, { recursive: true });
        await fs.writeFile(path.join(d4, "deep.txt"), "too deep");
        const reader = new FileReader([tmpDir]);
        // Start from d1 — d4 is at depth 3 from d1, so its contents (depth 4) are skipped
        const results = await reader.readContextFiles([d1]);
        const paths = results.map((r) => r.path);
        expect(paths.some((p) => p.includes("deep.txt"))).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// Default ignore patterns (Requirement 16.5)
// ---------------------------------------------------------------------------
describe("loadIgnoreRules — default ignore patterns", () => {
    it("ignores node_modules/ by default", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores("node_modules/")).toBe(true);
        expect(ig.ignores("node_modules/some-package/index.js")).toBe(true);
    });
    it("ignores .git/ by default", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores(".git/")).toBe(true);
    });
    it("ignores dist/ by default", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores("dist/")).toBe(true);
    });
    it("ignores build/ by default", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores("build/")).toBe(true);
    });
    it("ignores common image extensions by default", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores("image.png")).toBe(true);
        expect(ig.ignores("photo.jpg")).toBe(true);
        expect(ig.ignores("icon.svg")).toBe(true);
        expect(ig.ignores("favicon.ico")).toBe(true);
    });
    it("ignores archive and binary extensions by default", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores("archive.zip")).toBe(true);
        expect(ig.ignores("file.tar")).toBe(true);
        expect(ig.ignores("file.gz")).toBe(true);
        expect(ig.ignores("program.exe")).toBe(true);
        expect(ig.ignores("data.bin")).toBe(true);
    });
    it("ignores .lock files by default", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores("package-lock.json")).toBe(false); // .lock extension only
        expect(ig.ignores("yarn.lock")).toBe(true);
    });
    it("does not ignore regular source files", async () => {
        const ig = await loadIgnoreRules(tmpDir);
        expect(ig.ignores("src/index.ts")).toBe(false);
        expect(ig.ignores("README.md")).toBe(false);
        expect(ig.ignores("package.json")).toBe(false);
    });
    it("merges .bridgeignore patterns with defaults", async () => {
        await fs.writeFile(path.join(tmpDir, ".bridgeignore"), "*.secret\ntmp/\n");
        const ig = await loadIgnoreRules(tmpDir);
        // Default patterns still active
        expect(ig.ignores("node_modules/")).toBe(true);
        // Custom patterns also active
        expect(ig.ignores("credentials.secret")).toBe(true);
        expect(ig.ignores("tmp/")).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// Symlink traversal rejection (Requirement 3.8)
// ---------------------------------------------------------------------------
// Symlinks require elevated privileges on Windows — skip on that platform
const describeSymlinks = process.platform === "win32" ? describe.skip : describe;
describeSymlinks("FileReader — symlink traversal rejection", () => {
    it("rejects a symlink that points outside allowed directories", async () => {
        // Create a file outside tmpDir
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));
        const outsideFile = path.join(outsideDir, "secret.txt");
        await fs.writeFile(outsideFile, "secret content");
        // Create a symlink inside tmpDir pointing to the outside file
        const symlinkPath = path.join(tmpDir, "link-to-outside.txt");
        await fs.symlink(outsideFile, symlinkPath);
        try {
            const reader = new FileReader([tmpDir]);
            const results = await reader.readContextFiles([symlinkPath]);
            expect(results).toHaveLength(1);
            expect(results[0].content).toBeNull();
            expect(results[0].error).toMatch(/SECURITY ERROR/);
        }
        finally {
            await fs.rm(outsideDir, { recursive: true, force: true });
        }
    });
    it("allows a symlink that points inside allowed directories", async () => {
        // Create a real file inside tmpDir
        const realFile = path.join(tmpDir, "real.txt");
        await fs.writeFile(realFile, "real content");
        // Create a symlink inside tmpDir pointing to the real file
        const symlinkPath = path.join(tmpDir, "link-to-real.txt");
        await fs.symlink(realFile, symlinkPath);
        const reader = new FileReader([tmpDir]);
        const results = await reader.readContextFiles([symlinkPath]);
        expect(results).toHaveLength(1);
        expect(results[0].content).toBe("real content");
        expect(results[0].error).toBeUndefined();
    });
    it("rejects a symlink directory that points outside allowed directories", async () => {
        // Create a directory outside tmpDir with a file
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "outside-dir-"));
        await fs.writeFile(path.join(outsideDir, "file.txt"), "outside content");
        // Create a symlink directory inside tmpDir pointing to the outside dir
        const symlinkDir = path.join(tmpDir, "linked-dir");
        await fs.symlink(outsideDir, symlinkDir);
        try {
            const reader = new FileReader([tmpDir]);
            const results = await reader.readContextFiles([symlinkDir]);
            // The symlink dir itself should be rejected
            expect(results).toHaveLength(1);
            expect(results[0].content).toBeNull();
            expect(results[0].error).toMatch(/SECURITY ERROR/);
        }
        finally {
            await fs.rm(outsideDir, { recursive: true, force: true });
        }
    });
});
// ---------------------------------------------------------------------------
// Missing file handling (Requirement 3.3)
// ---------------------------------------------------------------------------
describe("FileReader — missing file handling", () => {
    it("returns file not found error for non-existent paths", async () => {
        const reader = new FileReader([tmpDir]);
        const results = await reader.readContextFiles([
            path.join(tmpDir, "does-not-exist.txt"),
        ]);
        expect(results).toHaveLength(1);
        expect(results[0].content).toBeNull();
        expect(results[0].error).toBe("file not found");
    });
    it("continues processing remaining files after a missing file", async () => {
        const existingFile = path.join(tmpDir, "exists.txt");
        await fs.writeFile(existingFile, "hello");
        const reader = new FileReader([tmpDir]);
        const results = await reader.readContextFiles([
            path.join(tmpDir, "missing.txt"),
            existingFile,
        ]);
        expect(results).toHaveLength(2);
        const missing = results.find((r) => r.path.includes("missing.txt"));
        const existing = results.find((r) => r.path.includes("exists.txt"));
        expect(missing?.error).toBe("file not found");
        expect(existing?.content).toBe("hello");
    });
});
// ---------------------------------------------------------------------------
// Binary file detection (Requirement 16.4)
// ---------------------------------------------------------------------------
describe("FileReader — binary file detection", () => {
    it("excludes files containing null bytes", async () => {
        const binaryFile = path.join(tmpDir, "binary.dat");
        await fs.writeFile(binaryFile, Buffer.from("text\0binary"));
        const reader = new FileReader([tmpDir]);
        const results = await reader.readContextFiles([binaryFile]);
        expect(results).toHaveLength(1);
        expect(results[0].content).toBeNull();
        expect(results[0].error).toBe("binary file");
    });
    it("includes valid UTF-8 text files", async () => {
        const textFile = path.join(tmpDir, "text.txt");
        await fs.writeFile(textFile, "Hello, world! 🌍");
        const reader = new FileReader([tmpDir]);
        const results = await reader.readContextFiles([textFile]);
        expect(results).toHaveLength(1);
        expect(results[0].content).toBe("Hello, world! 🌍");
        expect(results[0].error).toBeUndefined();
    });
});
//# sourceMappingURL=file_reader.test.js.map