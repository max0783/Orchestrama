/**
 * File reader with security enforcement, .bridgeignore support, and binary detection.
 * Requirements: 3.1–3.9, 16.1–16.7
 */

import fs from "fs/promises";
import path from "path";
import ignoreModule, { type Ignore as IgnoreInstance } from "ignore";

// The ignore package exports a default factory function; handle both CJS interop shapes.
const ignoreFactory: (options?: { ignorecase?: boolean }) => IgnoreInstance =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ignoreModule as any).default ?? ignoreModule;
import { type FileReadResult } from "../types.js";
import type { IPathValidator } from "../security/path_validator.js";

export type { IgnoreInstance };

/** Interface for the file reader — use this in dependency injection so tests can pass plain objects. */
export interface IFileReader {
  readContextFiles(paths: string[], ignoreRules?: IgnoreInstance): Promise<FileReadResult[]>;
  formatForPayload(results: FileReadResult[]): string;
}

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
 * @deprecated Use PathValidator.isAllowed instead. This function is kept for backward compatibility.
 */
export function isPathAllowed(resolvedPath: string, allowedDirs: string[]): boolean {
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
export async function loadIgnoreRules(cwd: string): Promise<IgnoreInstance> {
  const ig = ignoreFactory();

  const bridgeignorePath = path.join(cwd, ".bridgeignore");
  try {
    const content = await fs.readFile(bridgeignorePath, "utf-8");
    ig.add(content);
  } catch {
    // .bridgeignore doesn't exist — that's fine
  }

  // Add defaults last so they always win over any negation in .bridgeignore
  ig.add(DEFAULT_IGNORE_PATTERNS);
  (ig as IgnoreInstance & { __baseDir?: string }).__baseDir = cwd;

  return ig;
}

export class FileReader {
  private pathValidator: IPathValidator;
  private sessionId: string;

  constructor(pathValidator: IPathValidator, sessionId: string = "default") {
    this.pathValidator = pathValidator;
    this.sessionId = sessionId;
  }

  /**
   * Read a list of file/directory paths, applying security checks and ignore rules.
   */
  async readContextFiles(
    paths: string[],
    ignoreRules?: IgnoreInstance
  ): Promise<FileReadResult[]> {
    const results: FileReadResult[] = [];
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
  formatForPayload(results: FileReadResult[]): string {
    const entries: string[] = [];

    for (const result of results) {
      if (result.content !== null) {
        entries.push(`### File: ${result.path}\n${result.content}`);
      } else if (result.error === "file not found") {
        entries.push(`### File: ${result.path}\n[ERROR: file not found]`);
      } else if (result.error?.startsWith("SECURITY ERROR")) {
        entries.push(
          `### File: ${result.path}\n[SECURITY ERROR: path outside allowed directories]`
        );
      } else if (result.error === "binary file") {
        // Skip binary files — do not include in payload
      }
      // Any other errors are also skipped
    }

    return entries.join("\n\n");
  }

  /** Recursively process a path (file or directory) up to maxDepth. */
  private async _processPath(
    inputPath: string,
    ignoreRules: IgnoreInstance | undefined,
    depth: number
  ): Promise<FileReadResult[]> {
    // Step 1: Resolve symlinks
    let resolvedPath: string;
    try {
      resolvedPath = await fs.realpath(inputPath);
    } catch {
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
    if (!this.pathValidator.isAllowed(resolvedPath, this.sessionId)) {
      process.stderr.write(
        `[orchestrama] WARNING: Security violation - path outside allowed directories: ${inputPath}\n`
      );
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
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      return [
        {
          path: inputPath,
          content: null,
          error: "file not found",
          tokenEstimate: 0,
        },
      ];
    }

    if (this._isIgnoredPath(resolvedPath, stat.isDirectory(), ignoreRules)) {
      process.stderr.write(
        `[orchestrama] INFO: Excluding ${inputPath} (matched .bridgeignore pattern)\n`
      );
      if (stat.isDirectory()) {
        return [];
      }
      return [
        {
          path: inputPath,
          content: null,
          error: "excluded by ignore rules",
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
  private async _readDirectory(
    dirPath: string,
    ignoreRules: IgnoreInstance | undefined,
    depth: number
  ): Promise<FileReadResult[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      return [];
    }

    const results: FileReadResult[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const subResults = await this._processPath(fullPath, ignoreRules, depth + 1);
      results.push(...subResults);
    }
    return results;
  }

  /** Read a single file, checking for binary content. */
  private async _readFile(
    originalPath: string,
    resolvedPath: string,
    ignoreRules: IgnoreInstance | undefined
  ): Promise<FileReadResult> {
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(resolvedPath);
    } catch {
      return {
        path: originalPath,
        content: null,
        error: "file not found",
        tokenEstimate: 0,
      };
    }

    // Binary detection: check for null bytes
    if (buffer.includes(0)) {
      process.stderr.write(
        `[orchestrama] WARNING: Excluding binary file: ${originalPath}\n`
      );
      return {
        path: originalPath,
        content: null,
        error: "binary file",
        tokenEstimate: 0,
      };
    }

    // Try to decode as UTF-8
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      process.stderr.write(
        `[orchestrama] WARNING: Excluding binary file: ${originalPath}\n`
      );
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

  private _isIgnoredPath(
    resolvedPath: string,
    isDirectory: boolean,
    ignoreRules: IgnoreInstance | undefined
  ): boolean {
    if (!ignoreRules) return false;
    const baseDir =
      (ignoreRules as IgnoreInstance & { __baseDir?: string }).__baseDir ?? process.cwd();
    const relativePath = path.relative(baseDir, resolvedPath);
    if (!relativePath || relativePath.startsWith("..")) {
      return false;
    }
    const normalized = relativePath.split(path.sep).join("/");
    return ignoreRules.ignores(isDirectory ? `${normalized}/` : normalized);
  }
}
