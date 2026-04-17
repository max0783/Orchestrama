// Feature: ollama-mcp-bridge, Property 2: Invalid parameter rejection
// For any invocation of `query_local_model` where `prompt` is not a string,
// or `context_files` is not an array of strings, the bridge should return an
// MCP error with code `invalid_params`.
//
// **Validates: Requirements 1.5**

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { createQueryHandler } from "../../tools/query.js";
import { Chunker } from "../../chunking/index.js";
import { CapabilityRouter } from "../../routing/capability_map.js";
import { SystemPromptInjector } from "../../prompts/system_prompt.js";
import { RequestQueue } from "../../queue/request_queue.js";
import { ProgressNotifier } from "../../notifications/progress.js";
import { PatternRegistry } from "../../patterns/registry.js";
import { IntentDispatcher } from "../../patterns/dispatcher.js";
import type { QueryHandlerDeps } from "../../tools/query.js";
import type { BridgeConfig } from "../../types.js";
import type { GenerateRequest, GenerateResponse, FileReadResult } from "../../types.js";

// ---------------------------------------------------------------------------
// createMockDeps helper
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<QueryHandlerDeps>): QueryHandlerDeps {
  const config: BridgeConfig = {
    ollamaBaseUrl: "http://localhost:11434",
    defaultModel: "llama3",
    contextWindow: 4096,
    keepAlive: "10m",
    keepAliveOnStart: false,
    allowedDirs: [process.cwd()],
    systemPrompt: "",
    capabilityMap: {},
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 5000,
    reductionLogPath: "./test-reductions.jsonl",
    logLevel: "info",
    disableProgress: true,
  };

  const mockGenerate = vi.fn(async (_req: GenerateRequest): Promise<GenerateResponse> => ({
    model: "llama3",
    response: "ok",
    context: [],
    done: true,
  }));

  const ollamaClient = {
    generate: mockGenerate,
    listModels: vi.fn(async () => []),
    ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
    showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
  };

  const fileReader = {
    readContextFiles: vi.fn(async (_paths: string[]): Promise<FileReadResult[]> => []),
    formatForPayload: vi.fn((_results: FileReadResult[]): string => ""),
  };

  const chunker = new Chunker(mockGenerate);
  const capabilityRouter = new CapabilityRouter({}, "llama3");
  const systemPromptInjector = new SystemPromptInjector("");
  const requestQueue = new RequestQueue(1, 10);

  const reductionLogger = {
    append: vi.fn(),
    readStats: vi.fn(async () => ({
      totalInvocations: 0,
      averageReductionRatio: 0,
      totalTokensSaved: 0,
      byModel: {},
      byTaskType: {},
    })),
  };

  const progressNotifier = new ProgressNotifier(() => {}, true);

  return {
    config,
    ollamaClient,
    fileReader,
    chunker,
    capabilityRouter,
    systemPromptInjector,
    requestQueue,
    reductionLogger,
    progressNotifier,
    intentDispatcher: new IntentDispatcher(new PatternRegistry()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: assert that calling handler with args throws McpError invalid_params
// ---------------------------------------------------------------------------

async function assertInvalidParams(args: unknown): Promise<void> {
  const deps = createMockDeps();
  const handler = createQueryHandler(deps);

  let thrownError: unknown;
  try {
    await handler(args);
  } catch (err) {
    thrownError = err;
  }

  expect(thrownError).toBeInstanceOf(McpError);
  expect((thrownError as McpError).code).toBe(ErrorCode.InvalidParams);
}

// ---------------------------------------------------------------------------
// Property 2: Invalid parameter rejection
// ---------------------------------------------------------------------------

describe("Property 2: Invalid parameter rejection", () => {
  it(
    "rejects when prompt is a number",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ noNaN: true }),
          async (promptValue) => {
            await assertInvalidParams({ prompt: promptValue });
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it(
    "rejects when prompt is a boolean",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          async (promptValue) => {
            await assertInvalidParams({ prompt: promptValue });
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it("rejects when prompt is null", async () => {
    await assertInvalidParams({ prompt: null });
  });

  it("rejects when prompt is undefined", async () => {
    await assertInvalidParams({ prompt: undefined });
  });

  it("rejects when prompt is an object", async () => {
    await assertInvalidParams({ prompt: { value: "hello" } });
  });

  it("rejects when prompt is an array", async () => {
    await assertInvalidParams({ prompt: ["hello"] });
  });

  it(
    "rejects when context_files is a plain string (not an array)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }), // valid prompt
          fc.string({ minLength: 1, maxLength: 100 }), // invalid context_files
          async (prompt, contextFiles) => {
            await assertInvalidParams({ prompt, context_files: contextFiles });
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it(
    "rejects when context_files is a number",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.integer(),
          async (prompt, contextFiles) => {
            await assertInvalidParams({ prompt, context_files: contextFiles });
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it(
    "rejects when context_files is an array containing non-string elements",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          // Array with at least one number element
          fc.array(fc.integer(), { minLength: 1, maxLength: 5 }),
          async (prompt, contextFiles) => {
            await assertInvalidParams({ prompt, context_files: contextFiles });
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it(
    "rejects when context_files is an array mixing strings and numbers",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer(),
          async (prompt, validPath, invalidItem) => {
            await assertInvalidParams({
              prompt,
              context_files: [validPath, invalidItem],
            });
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it(
    "accepts valid prompt string with no context_files",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          async (prompt) => {
            const deps = createMockDeps();
            const handler = createQueryHandler(deps);
            // Should not throw
            const result = await handler({ prompt });
            expect(result.content).toHaveLength(1);
            expect(result.content[0].type).toBe("text");
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it(
    "accepts valid prompt string with valid context_files array of strings",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 3 }),
          async (prompt, contextFiles) => {
            const deps = createMockDeps();
            const handler = createQueryHandler(deps);
            // Should not throw
            const result = await handler({ prompt, context_files: contextFiles });
            expect(result.content).toHaveLength(1);
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );
});
