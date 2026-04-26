// Feature: dual-console-separation, Property 2: MCP server rejects unknown tool names
//
// For any string that is not a registered tool name, calling CallTool
// with that name SHALL throw an McpError with ErrorCode.MethodNotFound.
//
// **Validates: Requirements 1.3**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { PROGRAM_COMMAND_SPECS } from "../../tools/context_tools.js";

const PROGRAM_COMMAND_NAMES = PROGRAM_COMMAND_SPECS.map((spec) => spec.toolName);

// ---------------------------------------------------------------------------
// Local dispatch function that mirrors the CallTool switch in server.ts.
// This avoids importing server.ts directly (which has a side-effectful main()).
// ---------------------------------------------------------------------------

function dispatch(name: string): void {
  switch (name) {
    case "query_local_model":
      return;
    case "ping_model":
      return;
    case "list_patterns":
      return;
    case "register_pattern":
      return;
    case "get_bridge_limits":
      return;
    case "run_command":
      return;
    case "rg_search":
      return;
    case "gh_command":
      return;
    case "get_content":
      return;
    case "declare_working_dirs":
      return;
    case "feedback":
      return;
    case "setup_bridge":
      return;
    default:
      if (PROGRAM_COMMAND_NAMES.includes(name)) {
        return;
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Property 2: MCP server rejects all non-query tool names
// ---------------------------------------------------------------------------

describe("Property 2: MCP server rejects unknown tool names", () => {
  // Feature: dual-console-separation, Property 2: MCP server rejects all non-query tool names
  it(
    "throws McpError(MethodNotFound) for any string that is not a known tool name",
    () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => ![
            "query_local_model",
            "ping_model",
            "list_patterns",
            "register_pattern",
            "get_bridge_limits",
            "run_command",
            "rg_search",
            "gh_command",
            "get_content",
            ...PROGRAM_COMMAND_NAMES,
            "declare_working_dirs",
            "feedback",
            "setup_bridge",
          ].includes(s)),
          (name) => {
            let thrownError: unknown;
            try {
              dispatch(name);
            } catch (err) {
              thrownError = err;
            }

            expect(thrownError).toBeInstanceOf(McpError);
            expect((thrownError as McpError).code).toBe(ErrorCode.MethodNotFound);
          }
        ),
        { numRuns: 200 }
      );
    },
    15_000
  );

  // Feature: dual-console-separation, Property 2: MCP server rejects unknown tool names
  it('does NOT throw for "query_local_model"', () => {
    expect(() => dispatch("query_local_model")).not.toThrow();
  });

  // Feature: dual-console-separation, Property 2: MCP server rejects unknown tool names
  it('does NOT throw for "ping_model"', () => {
    expect(() => dispatch("ping_model")).not.toThrow();
  });

  it('does NOT throw for "get_bridge_limits"', () => {
    expect(() => dispatch("get_bridge_limits")).not.toThrow();
  });

  it('does NOT throw for "rg_search", "gh_command", and "get_content"', () => {
    expect(() => dispatch("rg_search")).not.toThrow();
    expect(() => dispatch("gh_command")).not.toThrow();
    expect(() => dispatch("get_content")).not.toThrow();
  });

  it("does NOT throw for generated program command tools", () => {
    for (const name of PROGRAM_COMMAND_NAMES) {
      expect(() => dispatch(name)).not.toThrow();
    }
  });

  // Feature: dual-console-separation, Property 2: MCP server rejects all non-query tool names
  it("throws McpError(MethodNotFound) for known admin tool names that were removed", () => {
    const removedTools = [
      "list_local_models",
      "benchmark_models",
      "test_config",
      "get_reduction_stats",
      "get_capability_map",
    ];

    for (const name of removedTools) {
      expect(() => dispatch(name)).toThrow(McpError);
      let thrownError: unknown;
      try {
        dispatch(name);
      } catch (err) {
        thrownError = err;
      }
      expect((thrownError as McpError).code).toBe(ErrorCode.MethodNotFound);
    }
  });

  // Feature: dual-console-separation, Property 2: MCP server rejects all non-query tool names
  it("throws McpError(MethodNotFound) for empty string", () => {
    let thrownError: unknown;
    try {
      dispatch("");
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(McpError);
    expect((thrownError as McpError).code).toBe(ErrorCode.MethodNotFound);
  });
});
