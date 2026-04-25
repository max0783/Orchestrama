// Feature: smart-mcp-self-description, Property 1: MCP server exposes all tools
//
// For any instantiation of the MCP server, calling ListTools SHALL return
// an array containing exactly the names "query_local_model", "ping_model",
// "list_patterns", "register_pattern", "get_bridge_limits", and "setup_bridge"
// — no more, no fewer.
//
// **Validates: Requirements 1.1, 1.2, 1.4, 4.1, 3.1, 5.1**

import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS } from "../../server_tools.js";
import { PROGRAM_COMMAND_SPECS } from "../../tools/context_tools.js";

const EXPECTED_TOOLS = [
  "query_local_model",
  "ping_model",
  "list_patterns",
  "register_pattern",
  "get_bridge_limits",
  "run_command",
  "rg_search",
  "gh_command",
  "get_content",
  ...PROGRAM_COMMAND_SPECS.map((spec) => spec.toolName),
  "declare_working_dirs",
  "setup_bridge",
];

describe("Property 1: MCP server exposes the expected tool list", () => {
  it("TOOL_DEFINITIONS has exactly the expected number of entries", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(EXPECTED_TOOLS.length);
  });

  // Feature: dual-console-separation, Property 1: MCP server exposes the expected tool list
  it('first tool is named "query_local_model"', () => {
    expect(TOOL_DEFINITIONS[0].name).toBe("query_local_model");
  });

  // Feature: dual-console-separation, Property 1: MCP server exposes the expected tool list
  it('second tool is named "ping_model"', () => {
    expect(TOOL_DEFINITIONS[1].name).toBe("ping_model");
  });

  it("tool names are exactly the expected tools and no others", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOLS);
  });
});
