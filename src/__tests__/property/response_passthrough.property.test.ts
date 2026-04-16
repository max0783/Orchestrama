// Feature: ollama-mcp-bridge, Property 1: Response pass-through integrity
// For any non-empty prompt and any response string returned by the Ollama mock,
// the `query_local_model` tool should return that exact response string in the
// MCP content field without modification or truncation.
//
// **Validates: Requirements 1.4, 2.4**

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createQueryHandler } from "../../tools/query.js";
import { Chunker } from "../../chunking/index.js";
import { CapabilityRouter } from "../../routing/capability_map.js";
import { SystemPromptInjector } from "../../prompts/system_prompt.js";
import { RequestQueue } from "../../queue/request_queue.js";
import { ProgressNotifier } from "../../notifications/progress.js";
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
    response: "default mock response",
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 1: Response pass-through integrity
// ---------------------------------------------------------------------------

describe("Property 1: Response pass-through integrity", () => {
  it(
    "returns the exact response string from Ollama in the MCP content field",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Non-empty prompt
          fc.string({ minLength: 1, maxLength: 500 }),
          // Arbitrary response string (including empty, unicode, multiline)
          fc.string({ maxLength: 2000 }),
          async (prompt, ollamaResponse) => {
            const mockGenerate = vi.fn(
              async (_req: GenerateRequest): Promise<GenerateResponse> => ({
                model: "llama3",
                response: ollamaResponse,
                context: [],
                done: true,
              })
            );

            const deps = createMockDeps({
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
    showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
              },
              chunker: new Chunker(mockGenerate),
            });

            const handler = createQueryHandler(deps);
            const result = await handler({ prompt });

            // The response must be exactly what Ollama returned
            expect(result.content).toHaveLength(1);
            expect(result.content[0].type).toBe("text");
            expect(result.content[0].text).toBe(ollamaResponse);
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );

  it(
    "response is not truncated even for long response strings",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Non-empty prompt
          fc.string({ minLength: 1, maxLength: 200 }),
          // Long response string
          fc.string({ minLength: 500, maxLength: 5000 }),
          async (prompt, ollamaResponse) => {
            const mockGenerate = vi.fn(
              async (_req: GenerateRequest): Promise<GenerateResponse> => ({
                model: "llama3",
                response: ollamaResponse,
                context: [],
                done: true,
              })
            );

            const deps = createMockDeps({
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
    showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
              },
              chunker: new Chunker(mockGenerate),
            });

            const handler = createQueryHandler(deps);
            const result = await handler({ prompt });

            expect(result.content[0].text).toBe(ollamaResponse);
            expect(result.content[0].text.length).toBe(ollamaResponse.length);
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );
});
