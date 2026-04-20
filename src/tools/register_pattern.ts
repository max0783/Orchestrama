/**
 * register_pattern tool handler.
 *
 * Registers a new custom usage pattern in the PatternRegistry. Accepts a name
 * and description, delegates to the registry for validation and system prompt
 * derivation, and returns the newly registered pattern's details as formatted
 * text. Errors from the registry are returned as user-friendly text content
 * rather than re-thrown.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { PatternRegistry } from "../patterns/registry.js";

/**
 * Factory function that accepts a PatternRegistry and returns a handler function.
 */
export function createRegisterPatternHandler(registry: PatternRegistry) {
  return async (args: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;

    // Validate name — required string
    if (typeof a["name"] !== "string" || a["name"].trim() === "") {
      const error = new McpError(
        ErrorCode.InvalidParams,
        '"name" must be a non-empty string'
      );
      return {
        content: [{ type: "text" as const, text: `Error: ${error.message}` }],
      };
    }

    // Validate description — required string
    if (typeof a["description"] !== "string" || a["description"].trim() === "") {
      const error = new McpError(
        ErrorCode.InvalidParams,
        '"description" must be a non-empty string'
      );
      return {
        content: [{ type: "text" as const, text: `Error: ${error.message}` }],
      };
    }

    const name = a["name"] as string;
    const description = a["description"] as string;

    try {
      const pattern = await registry.register(name, description);

      const keywords =
        pattern.keywords.length > 0 ? pattern.keywords.join(", ") : "(none)";
      const type = pattern.isBuiltIn ? "Built-in" : "Custom";

      const text = [
        "Pattern registered successfully.",
        "",
        `Name: ${pattern.name}`,
        `Description: ${pattern.description}`,
        `System Prompt: ${pattern.systemPrompt}`,
        `Keywords: ${keywords}`,
        `Type: ${type}`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      // Catch McpError (and any other error) from the registry and return as
      // user-friendly text content — do NOT re-throw (Req 3.4)
      const message =
        err instanceof McpError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);

      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
      };
    }
  };
}
