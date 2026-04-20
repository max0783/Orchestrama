import path from "path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ISessionRegistry } from "../session/registry.js";

/**
 * PathValidator centralizes all path security logic for the Bridge.
 * 
 * It validates that requested paths fall within the effective allowed directories
 * (static dirs from config ∪ dynamic dirs from session registry).
 * 
 * Requirements: 3.1, 3.2, 2.6
 */

export interface IPathValidator {
  /** Returns true if the resolved path is within the effective dirs for the session. */
  isAllowed(resolvedPath: string, sessionId: string): boolean;
  /** Throws McpError if cwd is not within effective dirs. */
  assertCwdAllowed(cwd: string, sessionId: string): void;
  /** Returns the effective dirs (static ∪ dynamic) for a session. */
  getEffectiveDirs(sessionId: string): string[];
}

export class PathValidator implements IPathValidator {
  constructor(
    private readonly staticDirs: string[],
    private readonly registry: ISessionRegistry
  ) {}

  getEffectiveDirs(sessionId: string): string[] {
    const dynamic = this.registry.getDynamicDirs(sessionId);
    // Union, preserving order: static first, then dynamic additions
    return Array.from(new Set([...this.staticDirs, ...dynamic]));
  }

  isAllowed(resolvedPath: string, sessionId: string): boolean {
    const effectiveDirs = this.getEffectiveDirs(sessionId);
    
    // Platform-specific case sensitivity handling
    const isWindows = process.platform === "win32";
    const normalizedPath = isWindows ? resolvedPath.toLowerCase() : resolvedPath;
    
    return effectiveDirs.some((dir) => {
      const normalizedDir = isWindows ? dir.toLowerCase() : dir;
      
      // Ensure dir ends with path separator for proper prefix matching
      const dirWithSep = normalizedDir.endsWith(path.sep) 
        ? normalizedDir 
        : normalizedDir + path.sep;
      
      // Path is allowed if it equals the dir or starts with dir + separator
      return normalizedPath === normalizedDir || normalizedPath.startsWith(dirWithSep);
    });
  }

  assertCwdAllowed(cwd: string, sessionId: string): void {
    if (!this.isAllowed(cwd, sessionId)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `SECURITY: cwd "${cwd}" is outside allowed directories. ` +
          `Effective dirs: ${this.getEffectiveDirs(sessionId).join(", ")}`
      );
    }
  }
}
