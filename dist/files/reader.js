/**
 * File reader with security enforcement, .bridgeignore support, and binary detection.
 * Requirements: 3.1–3.9, 16.1–16.7
 */
import fs from "fs/promises";
import path from "path";
import ignoreModule from "ignore";
// The ignore package exports a default factory function; handle both CJS interop shapes.
const ignoreFactory = 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
ignoreModule.default ?? ignoreModule;
/** Default patterns always ignored regardless of .bridgeignore. */
const DEFAULT_IGNORE_PATTERNS = [
    "node_modules/",
    ".git/",
    "dist/",
    "build/",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.svg",
    "*.ico",
    "*.pdf",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.exe",
    "*.bin",
    "*.lock",
];
/**
 * Check if a resolved path is under any of the allowed directories.
 */
export function isPathAllowed(resolvedPath, allowedDirs) {
    return allowedDirs.some((dir) => {
        const normalizedDir = dir.endsWith(path.sep) ? dir : dir + path.sep;
        return resolvedPath === dir || resolvedPath.startsWith(normalizedDir);
    });
}
/**
 * Load ignore rules from a .bridgeignore file in `cwd`, always including default patterns.
 * Default patterns are added AFTER user content so they cannot be negated by the
 * .bridgeignore file (e.g. a `!dist/` line must not re-enable dist/).
 */
export async function loadIgnoreRules(cwd) {
    const ig = ignoreFactory();
    const bridgeignorePath = path.join(cwd, ".bridgeignore");
    try {
        const content = await fs.readFile(bridgeignorePath, "utf-8");
        ig.add(content);
    }
    catch {
        // .bridgeignore doesn't exist — that's fine
    }
    // Add defaults last so they always win over any negation in .bridgeignore
    ig.add(DEFAULT_IGNORE_PATTERNS);
    return ig;
}
export class FileReader {
    allowedDirs;
    constructor(allowedDirs) {
        this.allowedDirs = allowedDirs;
    }
    /**
     * Read a list of file/directory paths, applying security checks and ignore rules.
     */
    async readContextFiles(paths, ignoreRules) {
        const results = [];
        for (const p of paths) {
            const fileResults = await this._processPath(p, ignoreRules, 0);
            results.push(...fileResults);
        }
        return results;
    }
    /**
     * Format FileReadResult[] into a payload string for the local model.
     * Binary files are skipped; errors are represented as markers.
     */
    formatForPayload(results) {
        const entries = [];
        for (const result of results) {
            if (result.content !== null) {
                entries.push(`### File: ${result.path}\n${result.content}`);
            }
            else if (result.error === "file not found") {
                entries.push(`### File: ${result.path}\n[ERROR: file not found]`);
            }
            else if (result.error?.startsWith("SECURITY ERROR")) {
                entries.push(`### File: ${result.path}\n[SECURITY ERROR: path outside allowed directories]`);
            }
            else if (result.error === "binary file") {
                // Skip binary files — do not include in payload
            }
            // Any other errors are also skipped
        }
        return entries.join("\n\n");
    }
    /** Recursively process a path (file or directory) up to maxDepth. */
    async _processPath(inputPath, ignoreRules, depth) {
        // Step 1: Resolve symlinks
        let resolvedPath;
        try {
            resolvedPath = await fs.realpath(inputPath);
        }
        catch {
            return [
                {
                    path: inputPath,
                    content: null,
                    error: "file not found",
                    tokenEstimate: 0,
                },
            ];
        }
        // Step 2: Security check
        if (!isPathAllowed(resolvedPath, this.allowedDirs)) {
            process.stderr.write(`[ollama-mcp-bridge] WARNING: Security violation - path outside allowed directories: ${inputPath}\n`);
            return [
                {
                    path: inputPath,
                    content: null,
                    error: "SECURITY ERROR: path outside allowed directories",
                    tokenEstimate: 0,
                },
            ];
        }
        // Step 3: Stat to determine file vs directory
        let stat;
        try {
            stat = await fs.stat(resolvedPath);
        }
        catch {
            return [
                {
                    path: inputPath,
                    content: null,
                    error: "file not found",
                    tokenEstimate: 0,
                },
            ];
        }
        if (stat.isDirectory()) {
            if (depth >= 3) {
                // Max depth reached — skip
                return [];
            }
            return this._readDirectory(resolvedPath, ignoreRules, depth);
        }
        // It's a file
        return [await this._readFile(inputPath, resolvedPath, ignoreRules)];
    }
    /** Read all files in a directory recursively up to depth 3. */
    async _readDirectory(dirPath, ignoreRules, depth) {
        let entries;
        try {
            entries = await fs.readdir(dirPath);
        }
        catch {
            return [];
        }
        const results = [];
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry);
            // Apply ignore rules relative to the directory
            if (ignoreRules) {
                const relEntry = entry + (await this._isDir(fullPath) ? "/" : "");
                if (ignoreRules.ignores(relEntry) || ignoreRules.ignores(entry)) {
                    process.stderr.write(`[ollama-mcp-bridge] INFO: Excluding ${fullPath} (matched .bridgeignore pattern)\n`);
                    continue;
                }
            }
            const subResults = await this._processPath(fullPath, ignoreRules, depth + 1);
            results.push(...subResults);
        }
        return results;
    }
    /** Read a single file, checking for binary content. */
    async _readFile(originalPath, resolvedPath, ignoreRules) {
        // Apply ignore rules to the file name
        if (ignoreRules) {
            const basename = path.basename(resolvedPath);
            if (ignoreRules.ignores(basename)) {
                process.stderr.write(`[ollama-mcp-bridge] INFO: Excluding ${originalPath} (matched .bridgeignore pattern)\n`);
                return {
                    path: originalPath,
                    content: null,
                    error: "excluded by ignore rules",
                    tokenEstimate: 0,
                };
            }
        }
        let buffer;
        try {
            buffer = await fs.readFile(resolvedPath);
        }
        catch {
            return {
                path: originalPath,
                content: null,
                error: "file not found",
                tokenEstimate: 0,
            };
        }
        // Binary detection: check for null bytes
        if (buffer.includes(0)) {
            process.stderr.write(`[ollama-mcp-bridge] WARNING: Excluding binary file: ${originalPath}\n`);
            return {
                path: originalPath,
                content: null,
                error: "binary file",
                tokenEstimate: 0,
            };
        }
        // Try to decode as UTF-8
        let content;
        try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        }
        catch {
            process.stderr.write(`[ollama-mcp-bridge] WARNING: Excluding binary file: ${originalPath}\n`);
            return {
                path: originalPath,
                content: null,
                error: "binary file",
                tokenEstimate: 0,
            };
        }
        return {
            path: originalPath,
            content,
            error: undefined,
            tokenEstimate: Math.floor(content.length / 4),
        };
    }
    /** Helper: check if a path is a directory without throwing. */
    async _isDir(p) {
        try {
            return (await fs.stat(p)).isDirectory();
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=reader.js.map