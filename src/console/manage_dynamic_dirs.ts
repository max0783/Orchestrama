/**
 * Console UI for managing dynamic allowed directories.
 *
 * Allows users to:
 * - View static allowed dirs (from BRIDGE_ALLOWED_DIRS)
 * - View current session's dynamic dirs
 * - Add new dynamic dirs
 * - Clear dynamic dirs
 *
 * Requirements: dynamic-allowed-dirs feature
 */

import fs from "fs/promises";
import path from "path";
import readline from "readline";
import type { BridgeConfig } from "../types.js";
import type { ISessionRegistry } from "../session/registry.js";
import { selectOne, selectMany, SelectorCancelledError, type SelectItem } from "./selector.js";

export interface ManageDynamicDirsOptions {
  config: BridgeConfig;
  registry: ISessionRegistry;
  sessionId: string;
  rl: readline.Interface;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Validates that a path exists and is a directory.
 */
async function validatePath(inputPath: string): Promise<{ valid: boolean; resolved?: string; error?: string }> {
  try {
    const resolved = await fs.realpath(inputPath);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      return { valid: false, error: "path is not a directory" };
    }
    return { valid: true, resolved };
  } catch (err) {
    return { valid: false, error: "path does not exist or cannot be accessed" };
  }
}

/**
 * Checks if a path is within the static allowed dirs.
 */
function isWithinStaticDirs(resolvedPath: string, staticDirs: string[]): boolean {
  const isWindows = process.platform === "win32";
  const normalizedPath = isWindows ? resolvedPath.toLowerCase() : resolvedPath;

  return staticDirs.some((dir) => {
    const normalizedDir = isWindows ? dir.toLowerCase() : dir;
    const dirWithSep = normalizedDir.endsWith(path.sep) ? normalizedDir : normalizedDir + path.sep;
    return normalizedPath === normalizedDir || normalizedPath.startsWith(dirWithSep);
  });
}

export async function manageDynamicDirs(opts: ManageDynamicDirsOptions): Promise<void> {
  const { config, registry, sessionId, rl } = opts;

  while (true) {
    const staticDirs = config.allowedDirs;
    const dynamicDirs = registry.getDynamicDirs(sessionId);
    const effectiveDirs = Array.from(new Set([...staticDirs, ...dynamicDirs]));

    console.log("\n── Dynamic Allowed Directories ──");
    console.log(`\nStatic dirs (from BRIDGE_ALLOWED_DIRS):`);
    if (staticDirs.length === 0) {
      console.log("  (none configured)");
    } else {
      staticDirs.forEach((d) => console.log(`  • ${d}`));
    }

    console.log(`\nDynamic dirs (session-scoped):`);
    if (dynamicDirs.length === 0) {
      console.log("  (none declared)");
    } else {
      dynamicDirs.forEach((d) => console.log(`  • ${d}`));
    }

    console.log(`\nEffective dirs (static ∪ dynamic):`);
    effectiveDirs.forEach((d) => console.log(`  • ${d}`));

    // Menu
    type Action = "add" | "remove" | "clear" | "back";
    const menuItems: SelectItem<Action>[] = [
      { label: "Add a directory", value: "add" },
      ...(dynamicDirs.length > 0 ? [{ label: "Remove a directory", value: "remove" as Action }] : []),
      ...(dynamicDirs.length > 0 ? [{ label: "Clear all dynamic dirs", value: "clear" as Action }] : []),
      { label: "Back to main menu", value: "back" },
    ];

    let action: Action;
    try {
      action = await selectOne(menuItems, { title: "\nWhat would you like to do?" });
    } catch (err) {
      if (err instanceof SelectorCancelledError) {
        return;
      }
      throw err;
    }

    if (action === "back") {
      return;
    }

    if (action === "add") {
      // Get path from user
      const inputPath = (await prompt(rl, "\nEnter directory path to add: ")).trim();
      if (!inputPath) {
        console.log("Cancelled.");
        continue;
      }

      // Validate path
      const validation = await validatePath(inputPath);
      if (!validation.valid) {
        console.log(`✗ Error: ${validation.error}`);
        continue;
      }

      const resolved = validation.resolved!;

      // Check security policy
      if (config.allowedDirsExplicit && !isWithinStaticDirs(resolved, staticDirs)) {
        console.log(
          `✗ Security policy: path must be within static allowed dirs when BRIDGE_ALLOWED_DIRS is set.`
        );
        console.log(`  Path: ${resolved}`);
        console.log(`  Static dirs: ${staticDirs.join(", ")}`);
        continue;
      }

      // Add to registry
      registry.addDirs(sessionId, [resolved]);
      console.log(`✓ Added: ${resolved}`);
    }

    if (action === "remove") {
      // Let user pick which dir to remove
      const removeItems: SelectItem<string>[] = dynamicDirs.map((d) => ({
        label: d,
        value: d,
      }));

      let toRemove: string;
      try {
        toRemove = await selectOne(removeItems, { title: "\nSelect directory to remove:" });
      } catch (err) {
        if (err instanceof SelectorCancelledError) {
          continue;
        }
        throw err;
      }

      // Remove by rebuilding the list without this entry
      const updated = dynamicDirs.filter((d) => d !== toRemove);
      registry.clearSession(sessionId);
      if (updated.length > 0) {
        registry.addDirs(sessionId, updated);
      }
      console.log(`✓ Removed: ${toRemove}`);
    }

    if (action === "clear") {
      const confirm = (await prompt(rl, "\nClear all dynamic directories? (y/N): ")).trim().toLowerCase();
      if (confirm === "y" || confirm === "yes") {
        registry.clearSession(sessionId);
        console.log("✓ All dynamic directories cleared.");
      } else {
        console.log("Cancelled.");
      }
    }
  }
}
