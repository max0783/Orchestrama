/**
 * File reader with security enforcement, .bridgeignore support, and binary detection.
 * Requirements: 3.1–3.9, 16.1–16.7
 */
import { type Ignore as IgnoreInstance } from "ignore";
import { type FileReadResult } from "../types.js";
export type { IgnoreInstance };
/** Interface for the file reader — use this in dependency injection so tests can pass plain objects. */
export interface IFileReader {
    readContextFiles(paths: string[], ignoreRules?: IgnoreInstance): Promise<FileReadResult[]>;
    formatForPayload(results: FileReadResult[]): string;
}
/**
 * Check if a resolved path is under any of the allowed directories.
 */
export declare function isPathAllowed(resolvedPath: string, allowedDirs: string[]): boolean;
/**
 * Load ignore rules from a .bridgeignore file in `cwd`, always including default patterns.
 */
export declare function loadIgnoreRules(cwd: string): Promise<IgnoreInstance>;
export declare class FileReader {
    private allowedDirs;
    constructor(allowedDirs: string[]);
    /**
     * Read a list of file/directory paths, applying security checks and ignore rules.
     */
    readContextFiles(paths: string[], ignoreRules?: IgnoreInstance): Promise<FileReadResult[]>;
    /**
     * Format FileReadResult[] into a payload string for the local model.
     * Binary files are skipped; errors are represented as markers.
     */
    formatForPayload(results: FileReadResult[]): string;
    /** Recursively process a path (file or directory) up to maxDepth. */
    private _processPath;
    /** Read all files in a directory recursively up to depth 3. */
    private _readDirectory;
    /** Read a single file, checking for binary content. */
    private _readFile;
    /** Helper: check if a path is a directory without throwing. */
    private _isDir;
}
//# sourceMappingURL=reader.d.ts.map