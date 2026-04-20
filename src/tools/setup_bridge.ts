/**
 * setup_bridge tool handler.
 *
 * Parses and validates the `client`, `run_checks`, and `include_env` parameters,
 * delegates to SetupTool.generate(), and formats the result as readable text.
 * McpErrors from SetupTool are caught and returned as text content (not re-thrown).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { McpError } from "@modelcontextprotocol/sdk/types.js";
import type { SetupTool } from "./setup_bridge_tool.js";
import type { SupportedClient } from "./setup_bridge_tool.js";

/**
 * Factory function that accepts a SetupTool and returns a handler function.
 */
export function createSetupBridgeHandler(setupTool: SetupTool) {
  return async (args: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;

    // Parse client — optional string, default "generic"
    let client: SupportedClient = "generic";
    if (a["client"] !== undefined) {
      if (typeof a["client"] !== "string") {
        return {
          content: [
            {
              type: "text" as const,
              text: 'Error: "client" must be a string',
            },
          ],
        };
      }
      client = a["client"] as SupportedClient;
    }

    // Parse run_checks — optional boolean, default false
    const runChecks: boolean =
      typeof a["run_checks"] === "boolean" ? a["run_checks"] : false;

    // Parse include_env — optional boolean, default false
    const includeEnv: boolean =
      typeof a["include_env"] === "boolean" ? a["include_env"] : false;

    let result;
    try {
      result = await setupTool.generate(client, { runChecks, includeEnv });
    } catch (err) {
      // Catch McpError (invalid client, etc.) and return as text content
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

    // Format the result as readable text
    const sections: string[] = [];

    // ---- Config JSON section ----
    sections.push("=== MCP CONFIGURATION ===");
    sections.push("");
    const formatLabel = result.configFormat === "toml" ? "TOML" : "JSON";
    sections.push(`Format: ${formatLabel}`);
    sections.push(`Copy and paste the following into your ${client} MCP configuration file:`);
    sections.push("");
    sections.push(result.configSnippet);

    // ---- Usage prompt section ----
    sections.push("");
    sections.push("=== BRIDGE USAGE GUIDE ===");
    sections.push("");
    sections.push(result.usagePrompt);

    // ---- Health checks section (only when present) ----
    if (result.healthChecks !== undefined && result.healthChecks.length > 0) {
      sections.push("");
      sections.push("=== HEALTH CHECK RESULTS ===");
      sections.push("");

      for (const check of result.healthChecks) {
        const status = check.passed ? "✓ PASS" : "✗ FAIL";
        sections.push(`${status}  ${check.name}`);
        sections.push(`       ${check.detail}`);
        if (!check.passed && check.resolutionHint) {
          sections.push(`       Resolution: ${check.resolutionHint}`);
        }
        sections.push("");
      }

      // Remove trailing blank line
      if (sections[sections.length - 1] === "") {
        sections.pop();
      }
    }

    const text = sections.join("\n");
    return { content: [{ type: "text" as const, text }] };
  };
}
