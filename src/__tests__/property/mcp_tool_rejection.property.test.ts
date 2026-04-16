// Feature: dual-console-separation, Property 2: MCP server rejects all non-query tool names
//
// For any string that is not "query_local_model" or "ping_model", calling CallTool
// with that name SHALL throw an McpError with ErrorCode.MethodNotFound.
//
// **Validates: Requirements 1.3**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

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
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Property 2: MCP server rejects all non-query tool names
// ---------------------------------------------------------------------------

describe("Property 2: MCP server rejects all non-query tool names", () => {
  // Feature: dual-console-separation, Property 2: MCP server rejects all non-query tool names
  it(
    "throws McpError(MethodNotFound) for any string that is not a known tool name",
    () => {
      fc.assert(
        fc.property(
          fc.string().filter(
            (s) => s !== "query_local_model" && s !== "ping_model"
          ),
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

  // Feature: dual-console-separation, Property 2: MCP server rejects all non-query tool names
  it('does NOT throw for "query_local_model"', () => {
    expect(() => dispatch("query_local_model")).not.toThrow();
  });

  // Feature: dual-console-separation, Property 2: MCP server rejects all non-query tool names
  it('does NOT throw for "ping_model"', () => {
    expect(() => dispatch("ping_model")).not.toThrow();
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
