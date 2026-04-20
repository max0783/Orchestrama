/**
 * DotEnv_Writer — reads, merges, and writes `.env` files atomically.
 *
 * Requirements: 5.4, 5.5, 5.6, 5.7, 5.8
 */

import * as fs from "fs/promises";
import * as path from "path";

// ---------------------------------------------------------------------------
// Parser (Task 4.1)
// ---------------------------------------------------------------------------

/**
 * Parse `.env` file content into a Map of key → value.
 *
 * Rules:
 * - Split on `\n`
 * - Skip blank lines and lines starting with `#`
 * - Match `KEY=VALUE`, `KEY="VALUE"`, `KEY='VALUE'`
 * - Unquote values: strip surrounding `"..."` or `'...'`, unescape `\"` → `"`
 */
export function parseEnvContent(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip blank lines and comment lines
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Match KEY=VALUE (with optional quoting)
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = line.slice(eqIdx + 1);

    // Unquote double-quoted values: "..." → unescape \\ → \ and \" → "
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    // Unquote single-quoted values: '...' → literal (no escape processing)
    else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }

    result.set(key, value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Serializer (Task 4.2)
// ---------------------------------------------------------------------------

/**
 * Determine whether a value needs to be quoted.
 * Quote if the value contains whitespace, `"`, `'`, `\`, `=`, `\n`, or `\r`.
 */
function needsQuoting(value: string): boolean {
  return /[\s"'\\=\n\r]/.test(value);
}

/**
 * Serialize a single key-value pair to a `.env` line.
 */
function serializePair(key: string, value: string): string {
  if (needsQuoting(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${key}="${escaped}"`;
  }
  return `${key}=${value}`;
}

/**
 * Serialize a merged map back to `.env` file content, preserving blank lines
 * and comment lines from the original content in their original positions.
 *
 * Algorithm:
 * 1. Iterate original lines; for KEY=VALUE lines, replace the value if the
 *    key is present in `mergedMap`; track which keys have been emitted.
 * 2. Append any keys from `mergedMap` that were not present in the original.
 */
export function serializeEnvContent(
  originalLines: string[],
  mergedMap: Map<string, string>
): string {
  const emittedKeys = new Set<string>();
  const outputLines: string[] = [];

  for (const line of originalLines) {
    const trimmed = line.trim();

    // Preserve blank lines and comment lines as-is
    if (trimmed === "" || trimmed.startsWith("#")) {
      outputLines.push(line);
      continue;
    }

    // Try to parse as KEY=VALUE
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      outputLines.push(line);
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      outputLines.push(line);
      continue;
    }

    // Emit the (possibly updated) value for this key
    const value = mergedMap.get(key);
    if (value !== undefined) {
      outputLines.push(serializePair(key, value));
      emittedKeys.add(key);
    } else {
      // Key was in original but not in mergedMap — preserve original line
      outputLines.push(line);
      emittedKeys.add(key);
    }
  }

  // Append any new keys that were not in the original file
  for (const [key, value] of mergedMap) {
    if (!emittedKeys.has(key)) {
      outputLines.push(serializePair(key, value));
    }
  }

  return outputLines.join("\n");
}

// ---------------------------------------------------------------------------
// writeEnvKeys (Task 4.3)
// ---------------------------------------------------------------------------

/**
 * Write (or merge) key-value pairs into a `.env` file atomically.
 *
 * - Default `filePath`: `path.join(process.cwd(), ".env")`
 * - Reads existing file; on ENOENT treats as empty; on other errors logs to
 *   stderr and treats as empty.
 * - Merges: overwrites only the keys in `keys`, preserving all others.
 * - Writes atomically: writes to `{filePath}.tmp`, then renames to `{filePath}`.
 * - On write/rename error: logs to stderr and returns without throwing.
 */
export async function writeEnvKeys(
  keys: Record<string, string>,
  filePath?: string
): Promise<void> {
  const resolvedPath = filePath ?? path.join(process.cwd(), ".env");
  const tmpPath = `${resolvedPath}.tmp`;

  // Step 1: Read existing content
  let existingContent = "";
  try {
    existingContent = await fs.readFile(resolvedPath, "utf8");
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== "ENOENT") {
      process.stderr.write(
        `[console] Failed to read .env: ${nodeErr.message}\n`
      );
      // Treat as empty and proceed
    }
    // ENOENT → treat as empty (no log needed)
  }

  // Step 2: Parse existing content
  const existingMap = parseEnvContent(existingContent);
  const originalLines = existingContent.split("\n");

  // Step 3: Merge — overwrite only the keys in `keys`
  const mergedMap = new Map(existingMap);
  for (const [key, value] of Object.entries(keys)) {
    mergedMap.set(key, value);
  }

  // Step 4: Serialize
  const serialized = serializeEnvContent(originalLines, mergedMap);

  // Step 5: Write atomically
  try {
    await fs.writeFile(tmpPath, serialized, "utf8");
    await fs.rename(tmpPath, resolvedPath);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    process.stderr.write(
      `[console] Failed to write .env: ${nodeErr.message}\n`
    );
    // Clean up tmp file if it was created
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
