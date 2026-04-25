import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS } from "../../server_tools.js";
import { PROGRAM_COMMAND_SPECS } from "../../tools/context_tools.js";

describe("TOOL_DEFINITIONS", () => {
  // 1. All static tools plus generated command tools
  it("has the expected number of entries", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(11 + PROGRAM_COMMAND_SPECS.length);
  });

  // 2. Tool names are exactly the expected set
  it("contains exactly the expected tool names", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([
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
    ]);
  });

  // 3. query_local_model inputSchema contains optional `intent` field
  it("query_local_model inputSchema contains the intent field as an optional string parameter", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "query_local_model")!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties as unknown as Record<string, { type: string }>;
    expect(props["intent"]).toBeDefined();
    expect(props["intent"].type).toBe("string");
    // intent is optional — not in required array
    const required = (tool.inputSchema as { required?: string[] }).required ?? [];
    expect(required).not.toContain("intent");
  });

  // 4. list_patterns inputSchema contains optional `filter` field
  it("list_patterns inputSchema contains the optional filter field", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "list_patterns")!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties as unknown as Record<string, { type: string }>;
    expect(props["filter"]).toBeDefined();
    expect(props["filter"].type).toBe("string");
    // filter is optional — not in required array
    const required = (tool.inputSchema as { required?: string[] }).required ?? [];
    expect(required).not.toContain("filter");
  });

  // 5. register_pattern inputSchema has name and description as required fields
  it("register_pattern inputSchema has name and description as required fields", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "register_pattern")!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties as unknown as Record<string, { type: string }>;
    expect(props["name"]).toBeDefined();
    expect(props["name"].type).toBe("string");
    expect(props["description"]).toBeDefined();
    expect(props["description"].type).toBe("string");
    const required = (tool.inputSchema as { required?: string[] }).required ?? [];
    expect(required).toContain("name");
    expect(required).toContain("description");
  });

  // 6. get_bridge_limits has empty object schema
  it("get_bridge_limits inputSchema is an empty object", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "get_bridge_limits")!;
    expect(tool).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    const props = tool.inputSchema.properties as unknown as Record<string, unknown>;
    expect(Object.keys(props)).toHaveLength(0);
  });

  // 7. setup_bridge inputSchema contains client, run_checks, and include_env fields
  it("setup_bridge inputSchema contains client, run_checks, and include_env fields", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "setup_bridge")!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties as unknown as Record<string, { type: string }>;
    expect(props["client"]).toBeDefined();
    expect(props["client"].type).toBe("string");
    expect(props["run_checks"]).toBeDefined();
    expect(props["run_checks"].type).toBe("boolean");
    expect(props["include_env"]).toBeDefined();
    expect(props["include_env"].type).toBe("boolean");
  });

  // 8. run_command inputSchema has prompt, command, expected_output as required fields
  it("run_command inputSchema has prompt, command, expected_output as required fields", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "run_command")!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties as unknown as Record<string, { type: string }>;
    expect(props["prompt"]).toBeDefined();
    expect(props["command"]).toBeDefined();
    expect(props["expected_output"]).toBeDefined();
    const required = (tool.inputSchema as { required?: string[] }).required ?? [];
    expect(required).toContain("prompt");
    expect(required).toContain("command");
    expect(required).toContain("expected_output");
    // cwd and model are optional
    expect(required).not.toContain("cwd");
    expect(required).not.toContain("model");
  });

  // 9. declare_working_dirs inputSchema has paths as required array field
  it("declare_working_dirs inputSchema has paths as required array field", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "declare_working_dirs")!;
    expect(tool).toBeDefined();
    const props = tool.inputSchema.properties as unknown as Record<string, { type: string; items?: { type: string } }>;
    expect(props["paths"]).toBeDefined();
    expect(props["paths"].type).toBe("array");
    expect(props["paths"].items).toBeDefined();
    expect(props["paths"].items?.type).toBe("string");
    const required = (tool.inputSchema as { required?: string[] }).required ?? [];
    expect(required).toContain("paths");
  });

  it("context gathering tools require prompt plus their context selector", () => {
    const rgTool = TOOL_DEFINITIONS.find((t) => t.name === "rg_search")!;
    const ghTool = TOOL_DEFINITIONS.find((t) => t.name === "gh_command")!;
    const contentTool = TOOL_DEFINITIONS.find((t) => t.name === "get_content")!;

    expect((rgTool.inputSchema as { required?: string[] }).required).toEqual(["prompt", "pattern"]);
    expect((ghTool.inputSchema as { required?: string[] }).required).toEqual(["prompt", "args"]);
    expect((contentTool.inputSchema as { required?: string[] }).required).toEqual(["prompt", "paths"]);
  });

  it("program command tools require prompt and command", () => {
    for (const name of PROGRAM_COMMAND_SPECS.map((spec) => spec.toolName)) {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name)!;
      expect((tool.inputSchema as { required?: string[] }).required).toEqual(["prompt", "command"]);
    }
  });
});
