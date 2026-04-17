// Feature: smart-mcp-self-description
// Property tests for SetupTool / setup_bridge (Properties 12–16)
//
// **Validates: Requirements 5.2, 5.3, 5.4, 5.6, 7.2, 7.4**

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SetupTool, SUPPORTED_CLIENTS } from "../../tools/setup_bridge_tool.js";
import type { SupportedClient } from "../../tools/setup_bridge_tool.js";
import { PatternRegistry } from "../../patterns/registry.js";
import type { IOllamaClient, OllamaModelInfo } from "../../ollama/client.js";
import type { BridgeConfig } from "../../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUILT_IN_PATTERN_NAMES = [
  "code_review",
  "explain_code",
  "find_bugs",
  "find_ts_errors",
  "generate_tests",
  "log_analysis",
  "replace_text",
  "summarize",
];

const MCP_TOOL_NAMES = [
  "query_local_model",
  "ping_model",
  "list_patterns",
  "register_pattern",
  "get_bridge_limits",
  "setup_bridge",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockConfig(): BridgeConfig {
  return {
    ollamaBaseUrl: "http://localhost:11434",
    defaultModel: "llama3",
    contextWindow: 4096,
    keepAlive: "10m",
    keepAliveOnStart: false,
    allowedDirs: [process.cwd()],
    systemPrompt: "You are a helpful assistant.",
    capabilityMap: {},
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 300000,
    reductionLogPath: "./ollama-bridge-reductions.jsonl",
    logLevel: "info",
    disableProgress: false,
  };
}

function createMockOllamaClient(options?: {
  unreachable?: boolean;
  modelNotFound?: boolean;
}): IOllamaClient {
  const mockModelInfo: OllamaModelInfo = {
    parameters: "",
    details: {},
    modelInfoRaw: {},
    parsedParameters: {},
  };

  return {
    listModels: async () => {
      if (options?.unreachable) {
        throw new Error("ECONNREFUSED: Ollama not reachable");
      }
      return ["llama3"];
    },
    ping: async (_model: string) => {
      if (options?.modelNotFound) {
        throw new Error("Model not found");
      }
      return { loaded: true, responseTimeMs: 10 };
    },
    generate: async (_req) => ({
      model: "llama3",
      response: "mock response",
      context: [],
      done: true,
    }),
    showModel: async (_model: string) => mockModelInfo,
  };
}

/** Non-empty, non-whitespace-only string that is not a built-in pattern name */
const customPatternName = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(
    (s) =>
      s.trim().length > 0 &&
      !BUILT_IN_PATTERN_NAMES.includes(s.toLowerCase()) &&
      // Avoid names that could collide with built-ins case-insensitively
      !BUILT_IN_PATTERN_NAMES.some((n) => n === s.toLowerCase())
  );

const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Property 12: setup_bridge config snippet validity
// **Validates: Requirements 5.2**
// ---------------------------------------------------------------------------

describe("Property 12: setup_bridge config snippet validity", () => {
  it(
    "returns client-appropriate config snippet and always contains 'ollama-mcp-bridge'",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...SUPPORTED_CLIENTS),
          async (client: SupportedClient) => {
            const registry = new PatternRegistry();
            const ollamaClient = createMockOllamaClient();
            const config = createMockConfig();
            const setupTool = new SetupTool({ registry, ollamaClient, config });

            const result = await setupTool.generate(client);
            expect(result.configSnippet).toContain("ollama-mcp-bridge");
            expect(result.configJson).toBe(result.configSnippet);

            if (client === "codex") {
              expect(result.configFormat).toBe("toml");
              expect(result.configSnippet).toContain("[mcp_servers.ollama-mcp-bridge]");
              expect(result.configSnippet).toContain("args = [");
            } else {
              expect(result.configFormat).toBe("json");
              let parsed: unknown;
              expect(() => {
                parsed = JSON.parse(result.configSnippet);
              }).not.toThrow();
              const jsonStr = JSON.stringify(parsed);
              expect(jsonStr).toContain("ollama-mcp-bridge");
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 13: setup_bridge usage prompt completeness
// **Validates: Requirements 5.3, 5.6**
// ---------------------------------------------------------------------------

describe("Property 13: setup_bridge usage prompt completeness", () => {
  it(
    "usagePrompt contains every MCP tool name, every built-in pattern name, and every registered custom pattern name",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({ name: customPatternName, description: nonEmptyString }),
            { minLength: 0, maxLength: 5 }
          ),
          async (customPatterns) => {
            // Deduplicate by name (case-insensitive)
            const seen = new Set<string>();
            const unique = customPatterns.filter((p) => {
              const key = p.name.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });

            const registry = new PatternRegistry();
            for (const { name, description } of unique) {
              await registry.register(name, description);
            }

            const ollamaClient = createMockOllamaClient();
            const config = createMockConfig();
            const setupTool = new SetupTool({ registry, ollamaClient, config });

            const result = await setupTool.generate("generic");

            // Every MCP tool name must appear in usagePrompt
            for (const toolName of MCP_TOOL_NAMES) {
              expect(result.usagePrompt).toContain(toolName);
            }

            // Every built-in pattern name must appear in usagePrompt
            for (const patternName of BUILT_IN_PATTERN_NAMES) {
              expect(result.usagePrompt).toContain(patternName);
            }

            // Every registered custom pattern name must appear in usagePrompt
            for (const { name } of unique) {
              expect(result.usagePrompt).toContain(name.trim());
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 14: setup_bridge invalid client error
// **Validates: Requirements 5.4**
// ---------------------------------------------------------------------------

describe("Property 14: setup_bridge invalid client error", () => {
  it(
    "throws McpError whose message contains all supported client names when given an invalid client",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string().filter((s) => !SUPPORTED_CLIENTS.includes(s as SupportedClient)),
          async (invalidClient) => {
            const registry = new PatternRegistry();
            const ollamaClient = createMockOllamaClient();
            const config = createMockConfig();
            const setupTool = new SetupTool({ registry, ollamaClient, config });

            let thrownError: unknown;
            try {
              await setupTool.generate(invalidClient as SupportedClient);
            } catch (err) {
              thrownError = err;
            }

            // Must have thrown
            expect(thrownError).toBeDefined();

            // Error message must contain all supported client names
            const message =
              thrownError instanceof Error ? thrownError.message : String(thrownError);
            for (const supportedClient of SUPPORTED_CLIENTS) {
              expect(message).toContain(supportedClient);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 15: setup_bridge resilience when Ollama unreachable
// **Validates: Requirements 7.4**
// ---------------------------------------------------------------------------

describe("Property 15: setup_bridge resilience when Ollama unreachable", () => {
  it(
    "still returns non-empty configSnippet and usagePrompt even when Ollama is unreachable, with at least one failed health check",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null), // no meaningful input variation needed — the property is about the mock
          async () => {
            const registry = new PatternRegistry();
            const ollamaClient = createMockOllamaClient({ unreachable: true });
            const config = createMockConfig();
            const setupTool = new SetupTool({ registry, ollamaClient, config });

            // Should NOT throw even though Ollama is unreachable
            const result = await setupTool.generate("generic", { runChecks: true });

            // configSnippet must be non-empty
            expect(result.configSnippet.trim().length).toBeGreaterThan(0);

            // usagePrompt must be non-empty
            expect(result.usagePrompt.trim().length).toBeGreaterThan(0);

            // healthChecks must be present and contain at least one failed check
            expect(result.healthChecks).toBeDefined();
            expect(result.healthChecks!.length).toBeGreaterThan(0);
            const hasFailedCheck = result.healthChecks!.some((c) => !c.passed);
            expect(hasFailedCheck).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Property 16: Health check failure includes resolution hint
// **Validates: Requirements 7.2**
// ---------------------------------------------------------------------------

describe("Property 16: Health check failure includes resolution hint", () => {
  it(
    "every failed health check has a non-empty resolutionHint when Ollama is unreachable",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null),
          async () => {
            const registry = new PatternRegistry();
            const ollamaClient = createMockOllamaClient({ unreachable: true });
            const config = createMockConfig();
            const setupTool = new SetupTool({ registry, ollamaClient, config });

            const result = await setupTool.generate("generic", { runChecks: true });

            expect(result.healthChecks).toBeDefined();
            for (const check of result.healthChecks!) {
              if (!check.passed) {
                expect(typeof check.resolutionHint).toBe("string");
                expect(check.resolutionHint!.trim().length).toBeGreaterThan(0);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    "every failed health check has a non-empty resolutionHint when model is not found",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null),
          async () => {
            const registry = new PatternRegistry();
            // Ollama is reachable but the model is not found
            const ollamaClient = createMockOllamaClient({ modelNotFound: true });
            const config = createMockConfig();
            const setupTool = new SetupTool({ registry, ollamaClient, config });

            const result = await setupTool.generate("generic", { runChecks: true });

            expect(result.healthChecks).toBeDefined();
            for (const check of result.healthChecks!) {
              if (!check.passed) {
                expect(typeof check.resolutionHint).toBe("string");
                expect(check.resolutionHint!.trim().length).toBeGreaterThan(0);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
