/**
 * Unit tests for src/console/menu.ts
 *
 * Requirements: 2.2, 2.3
 */

import { describe, it, expect } from "vitest";
import { renderMenu, parseSelection } from "../../console/menu.js";
import type { MenuAction } from "../../console/menu.js";

describe("renderMenu()", () => {
  it("contains all 10 action labels", () => {
    const menu = renderMenu();
    expect(menu).toContain("List Models");
    expect(menu).toContain("Ping Model");
    expect(menu).toContain("Set Default Model");
    expect(menu).toContain("Run Benchmark");
    expect(menu).toContain("View Configuration");
    expect(menu).toContain("View Capability Map");
    expect(menu).toContain("View Reduction Stats");
    expect(menu).toContain("Test Configuration");
    expect(menu).toContain("Test Configuration (dry run)");
    expect(menu).toContain("Exit");
  });

  it("contains the header", () => {
    const menu = renderMenu();
    expect(menu).toContain("ollama-mcp-bridge Console");
  });

  it("returns a non-empty string", () => {
    expect(renderMenu().length).toBeGreaterThan(0);
  });
});

describe("parseSelection()", () => {
  const expectedMappings: Array<[string, MenuAction]> = [
    ["1", "list_models"],
    ["2", "ping_model"],
    ["3", "set_default_model"],
    ["4", "run_benchmark"],
    ["5", "view_config"],
    ["6", "view_capability_map"],
    ["7", "view_reduction_stats"],
    ["8", "test_config"],
    ["9", "test_config_dry"],
    ["0", "exit"],
  ];

  it.each(expectedMappings)(
    'maps "%s" to "%s"',
    (input, expected) => {
      expect(parseSelection(input)).toBe(expected);
    }
  );

  it("returns null for empty string", () => {
    expect(parseSelection("")).toBeNull();
  });

  it("returns null for letters", () => {
    expect(parseSelection("a")).toBeNull();
    expect(parseSelection("z")).toBeNull();
    expect(parseSelection("A")).toBeNull();
  });

  it("returns null for out-of-range numbers", () => {
    expect(parseSelection("10")).toBeNull();
    expect(parseSelection("-1")).toBeNull();
    expect(parseSelection("99")).toBeNull();
  });

  it("returns null for whitespace", () => {
    expect(parseSelection(" ")).toBeNull();
    expect(parseSelection(" 1")).toBeNull();
    expect(parseSelection("1 ")).toBeNull();
  });

  it("returns null for multi-character strings that are not valid", () => {
    expect(parseSelection("01")).toBeNull();
    expect(parseSelection("11")).toBeNull();
  });
});
