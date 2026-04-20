/**
 * list_patterns tool handler.
 *
 * Returns all registered usage patterns from the PatternRegistry, optionally
 * filtered by a search string. Output is formatted as human-readable text that
 * is also easy for an orchestrator to parse.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import type { PatternRegistry } from "../patterns/registry.js";

/**
 * Factory function that accepts a PatternRegistry and returns a handler function.
 */
export function createListPatternsHandler(registry: PatternRegistry) {
  return async (args: unknown) => {
    const rawFilter = (args as Record<string, unknown>)?.filter;

    // Validate filter: only use it if it's a string; ignore non-string values
    const filter: string | undefined =
      typeof rawFilter === "string" ? rawFilter : undefined;

    const patterns = registry.list(filter);
    const total = patterns.length;

    const header = filter
      ? `Available Usage Patterns matching "${filter}" (${total} total):`
      : `Available Usage Patterns (${total} total):`;

    if (total === 0) {
      const text = `${header}\n\n(no patterns found)`;
      return { content: [{ type: "text" as const, text }] };
    }

    const lines: string[] = [header, ""];

    for (const pattern of patterns) {
      const tag = pattern.isBuiltIn ? "[BUILT-IN]" : "[CUSTOM]";
      const keywords =
        pattern.keywords.length > 0 ? pattern.keywords.join(", ") : "(none)";

      lines.push(`${tag} ${pattern.name}`);
      lines.push(`  Description: ${pattern.description}`);
      lines.push(`  Keywords: ${keywords}`);
      lines.push("");
    }

    // Remove trailing blank line
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }

    const text = lines.join("\n");
    return { content: [{ type: "text" as const, text }] };
  };
}
