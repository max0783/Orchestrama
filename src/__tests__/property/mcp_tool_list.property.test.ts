// Feature: dual-console-separation, Property 1: MCP server exposes exactly the two query tools
//
// For any instantiation of the stripped MCP server, calling ListTools SHALL return
// an array containing exactly the names "query_local_model" and "ping_model" —
// no more, no fewer.
//
// **Validates: Requirements 1.1, 1.2, 1.4**

import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS } from "../../server_tools.js";

describe("Property 1: MCP server exposes exactly the two query tools", () => {
  // Feature: dual-console-separation, Property 1: MCP server exposes exactly the two query tools
  it("TOOL_DEFINITIONS has exactly 2 entries", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(2);
  });

  // Feature: dual-console-separation, Property 1: MCP server exposes exactly the two query tools
  it('first tool is named "query_local_model"', () => {
    expect(TOOL_DEFINITIONS[0].name).toBe("query_local_model");
  });

  // Feature: dual-console-separation, Property 1: MCP server exposes exactly the two query tools
  it('second tool is named "ping_model"', () => {
    expect(TOOL_DEFINITIONS[1].name).toBe("ping_model");
  });

  // Feature: dual-console-separation, Property 1: MCP server exposes exactly the two query tools
  it('tool names are exactly ["query_local_model", "ping_model"] and no others', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(["query_local_model", "ping_model"]);
  });
});
