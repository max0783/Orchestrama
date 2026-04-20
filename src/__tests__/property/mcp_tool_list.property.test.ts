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

const EXPECTED_TOOLS = [
  "query_local_model",
  "ping_model",
  "list_patterns",
  "register_pattern",
  "get_bridge_limits",
  "run_command",
  "declare_working_dirs",
  "setup_bridge",
];

describe("Property 1: MCP server exposes exactly the two query tools", () => {
  // Updated: declare_working_dirs added as 8th tool
  it("TOOL_DEFINITIONS has exactly 8 entries", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(8);
  });

  // Feature: dual-console-separation, Property 1: MCP server exposes exactly the two query tools
  it('first tool is named "query_local_model"', () => {
    expect(TOOL_DEFINITIONS[0].name).toBe("query_local_model");
  });

  // Feature: dual-console-separation, Property 1: MCP server exposes exactly the two query tools
  it('second tool is named "ping_model"', () => {
    expect(TOOL_DEFINITIONS[1].name).toBe("ping_model");
  });

  // Updated: declare_working_dirs added as 8th tool
  it("tool names are exactly the expected 8 tools and no others", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOLS);
  });
});
