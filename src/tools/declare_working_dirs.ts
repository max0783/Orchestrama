/**
 * declare_working_dirs tool handler.
 *
 * Allows AI clients to register additional working directories at runtime
 * (Dynamic_Dirs) for the current session. These are merged with Static_Dirs
 * from BRIDGE_ALLOWED_DIRS to form the effective allowed directories.
 *
 * Security policy:
 * - When BRIDGE_ALLOWED_DIRS is explicitly set: Dynamic_Dirs must be
 *   subdirectories of Static_Dirs (operator's intent is respected).
 * - When BRIDGE_ALLOWED_DIRS is not set (defaulting to cwd): any existing
 *   directory can be declared (zero friction for common case).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import fs from "fs/promises";
import path from "path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeConfig } from "../types.js";
import type { ISessionRegistry } from "../session/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeclareWorkingDirsHandlerDeps {
  config: BridgeConfig;
  registry: ISessionRegistry;
  sessionId: string;
}

interface RejectedPath {
  path: string;
  reason: string;
}

interface DeclareWorkingDirsResult {
  accepted: string[];
  rejected: RejectedPath[];
  static_dirs: string[];
  dynamic_dirs: string[];
  effective_dirs: string[];
}

// ---------------------------------------------------------------------------
// Path validation helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes path separators to the platform separator.
 * Requirements: 1.6
 */
function normalizeSeparators(p: string): string {
  return p.replace(/[\\/]/g, path.sep);
}

/**
 * Checks if a resolved path is equal to or a subdirectory of any static dir.
 * Platform-aware case sensitivity (Windows: case-insensitive, POSIX: case-sensitive).
 * Requirements: 2.1, 2.2
 */
function isSubdirOfStaticDirs(resolvedPath: string, staticDirs: string[]): boolean {
  const isWindows = process.platform === "win32";
  const normalizedPath = isWindows ? resolvedPath.toLowerCase() : resolvedPath;

  return staticDirs.some((dir) => {
    const normalizedDir = isWindows ? dir.toLowerCase() : dir;
    const dirWithSep = normalizedDir.endsWith(path.sep)
      ? normalizedDir
      : normalizedDir + path.sep;

    return normalizedPath === normalizedDir || normalizedPath.startsWith(dirWithSep);
  });
}

/**
 * Validates a single path candidate.
 * Returns { accepted: resolvedPath } or { rejected: { path, reason } }.
 * Requirements: 1.5, 2.3, 2.4, 2.5, 2.6
 */
async function validatePath(
  inputPath: string,
  staticDirs: string[],
  allowedDirsExplicit: boolean
): Promise<{ accepted?: string; rejected?: RejectedPath }> {
  // Step 1: Normalize separators
  const normalized = normalizeSeparators(inputPath);

  // Step 2: Resolve with fs.realpath (follows symlinks)
  let resolvedPath: string;
  try {
    resolvedPath = await fs.realpath(normalized);
  } catch (err) {
    return {
      rejected: {
        path: inputPath,
        reason: `path does not exist: ${inputPath}`,
      },
    };
  }

  // Step 3: Check if it's a directory
  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (err) {
    return {
      rejected: {
        path: inputPath,
        reason: `could not stat path: ${inputPath}`,
      },
    };
  }

  if (!stats.isDirectory()) {
    return {
      rejected: {
        path: inputPath,
        reason: `path is not a directory: ${inputPath}`,
      },
    };
  }

  // Step 4: Apply security policy
  if (allowedDirsExplicit) {
    // BRIDGE_ALLOWED_DIRS was explicitly set — enforce subset constraint
    if (!isSubdirOfStaticDirs(resolvedPath, staticDirs)) {
      return {
        rejected: {
          path: inputPath,
          reason: `path is outside static allowed dirs: ${inputPath}`,
        },
      };
    }
  }
  // Otherwise (defaulted to cwd): accept any existing directory

  return { accepted: resolvedPath };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

interface ValidatedInput {
  paths: string[];
}

function validateInput(args: unknown): ValidatedInput {
  if (typeof args !== "object" || args === null) {
    throw new McpError(ErrorCode.InvalidParams, "Arguments must be an object");
  }
  const a = args as Record<string, unknown>;

  if (!Array.isArray(a["paths"])) {
    throw new McpError(ErrorCode.InvalidParams, '"paths" must be an array');
  }

  const paths = a["paths"] as unknown[];
  for (let i = 0; i < paths.length; i++) {
    if (typeof paths[i] !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        `"paths[${i}]" must be a string, got ${typeof paths[i]}`
      );
    }
  }

  return { paths: paths as string[] };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createDeclareWorkingDirsHandler(deps: DeclareWorkingDirsHandlerDeps) {
  const { config, registry, sessionId } = deps;

  return async (args: unknown) => {
    // -----------------------------------------------------------------------
    // 1. Validate input
    // -----------------------------------------------------------------------
    const { paths } = validateInput(args);

    // -----------------------------------------------------------------------
    // 2. Validate each path (parallel for efficiency)
    // -----------------------------------------------------------------------
    const validationResults = await Promise.all(
      paths.map((p) =>
        validatePath(p, config.allowedDirs, config.allowedDirsExplicit)
      )
    );

    const accepted: string[] = [];
    const rejected: RejectedPath[] = [];

    for (const result of validationResults) {
      if (result.accepted) {
        accepted.push(result.accepted);
      } else if (result.rejected) {
        rejected.push(result.rejected);
      }
    }

    // -----------------------------------------------------------------------
    // 3. Add accepted paths to session registry
    // -----------------------------------------------------------------------
    if (accepted.length > 0) {
      registry.addDirs(sessionId, accepted);
    }

    // -----------------------------------------------------------------------
    // 4. Build response
    // -----------------------------------------------------------------------
    const dynamicDirs = registry.getDynamicDirs(sessionId);
    const effectiveDirs = Array.from(new Set([...config.allowedDirs, ...dynamicDirs]));

    const result: DeclareWorkingDirsResult = {
      accepted,
      rejected,
      static_dirs: config.allowedDirs,
      dynamic_dirs: dynamicDirs,
      effective_dirs: effectiveDirs,
    };

    const text = [
      "Working directories declared",
      JSON.stringify(result, null, 2),
      accepted.length > 0
        ? `✓ Accepted ${accepted.length} path(s)`
        : "No paths were accepted",
      rejected.length > 0
        ? `✗ Rejected ${rejected.length} path(s) — see "rejected" array for details`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return { content: [{ type: "text" as const, text }] };
  };
}
