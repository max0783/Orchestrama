// Feature: orchestrama, Property 19: OOM error classification and fallback
// For any Ollama error response whose body contains one of the OOM substrings,
// the bridge should classify the error as `local_resource_exhausted` and retry
// with the first available model from `BRIDGE_FALLBACK_MODELS`.
//
// **Validates: Requirements 17.1, 17.2, 17.4**

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createQueryHandler } from "../../tools/query.js";
import { Chunker } from "../../chunking/index.js";
import { CapabilityRouter } from "../../routing/capability_map.js";
import { SystemPromptInjector } from "../../prompts/system_prompt.js";
import { RequestQueue } from "../../queue/request_queue.js";
import { ProgressNotifier } from "../../notifications/progress.js";
import { OllamaError } from "../../ollama/client.js";
import { PatternRegistry } from "../../patterns/registry.js";
import { IntentDispatcher } from "../../patterns/dispatcher.js";
import type { QueryHandlerDeps } from "../../tools/query.js";
import type { BridgeConfig } from "../../types.js";
import type { GenerateRequest, GenerateResponse, FileReadResult } from "../../types.js";

// ---------------------------------------------------------------------------
// OOM substrings that trigger local_resource_exhausted classification
// ---------------------------------------------------------------------------

const OOM_SUBSTRINGS = [
  "out of memory",
  "cuda out of memory",
  "not enough memory",
];

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
    allowedDirsExplicit: false,
    systemPrompt: "",
    capabilityMap: {},
    fallbackModels: ["fallback-model"],
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
    listRunningModels: vi.fn(async () => []),
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
// Property 19: OOM error classification and fallback
// ---------------------------------------------------------------------------

describe("Property 19: OOM error classification and fallback", () => {
  it(
    "retries with fallback model when primary model throws OOM error",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Non-empty prompt
          fc.string({ minLength: 1, maxLength: 200 }),
          // OOM substring to use
          fc.constantFrom(...OOM_SUBSTRINGS),
          // Fallback model name
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim() !== "" && s !== "llama3"),
          // Expected response from fallback model
          fc.string({ minLength: 1, maxLength: 500 }),
          async (prompt, oomSubstring, fallbackModel, fallbackResponse) => {
            const primaryModel = "llama3";

            // Mock generate: throw OOM for primary, succeed for fallback
            const mockGenerate = vi.fn(
              async (req: GenerateRequest): Promise<GenerateResponse> => {
                if (req.model === primaryModel) {
                  throw new OllamaError(oomSubstring, "local_resource_exhausted");
                }
                // Fallback model succeeds
                return {
                  model: req.model,
                  response: fallbackResponse,
                  context: [],
                  done: true,
                };
              }
            );

            const config: BridgeConfig = {
              ollamaBaseUrl: "http://localhost:11434",
              defaultModel: primaryModel,
              contextWindow: 4096,
              keepAlive: "10m",
              keepAliveOnStart: false,
              allowedDirs: [process.cwd()],
              allowedDirsExplicit: false,
              systemPrompt: "",
              capabilityMap: {},
              fallbackModels: [fallbackModel],
              queueMaxSize: 10,
              numParallel: 1,
              requestTimeoutMs: 5000,
              reductionLogPath: "./test-reductions.jsonl",
              logLevel: "info",
              disableProgress: true,
            };

            const deps = createMockDeps({
              config,
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
                listRunningModels: vi.fn(async () => []),
              },
              chunker: new Chunker(mockGenerate),
              capabilityRouter: new CapabilityRouter({}, primaryModel),
            });

            const handler = createQueryHandler(deps);
            const result = await handler({ prompt });

            // Response should contain the fallback warning prefix
            expect(result.content).toHaveLength(1);
            expect(result.content[0].type).toBe("text");
            expect(result.content[0].text).toContain(
              `[FALLBACK: ${fallbackModel} used due to resource exhaustion on ${primaryModel}]`
            );
            // And the actual fallback response
            expect(result.content[0].text).toContain(fallbackResponse);
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );

  it(
    "uses the first fallback model from BRIDGE_FALLBACK_MODELS",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          // First fallback model (should be used)
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== "" && s !== "llama3"),
          // Second fallback model (should NOT be used if first succeeds)
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== "" && s !== "llama3"),
          async (prompt, firstFallback, secondFallback) => {
            // Ensure the two fallback models are different
            if (firstFallback === secondFallback) return;

            const primaryModel = "llama3";
            const modelsUsed: string[] = [];

            const mockGenerate = vi.fn(
              async (req: GenerateRequest): Promise<GenerateResponse> => {
                modelsUsed.push(req.model);
                if (req.model === primaryModel) {
                  throw new OllamaError("out of memory", "local_resource_exhausted");
                }
                return {
                  model: req.model,
                  response: `response from ${req.model}`,
                  context: [],
                  done: true,
                };
              }
            );

            const config: BridgeConfig = {
              ollamaBaseUrl: "http://localhost:11434",
              defaultModel: primaryModel,
              contextWindow: 4096,
              keepAlive: "10m",
              keepAliveOnStart: false,
              allowedDirs: [process.cwd()],
              allowedDirsExplicit: false,
              systemPrompt: "",
              capabilityMap: {},
              fallbackModels: [firstFallback, secondFallback],
              queueMaxSize: 10,
              numParallel: 1,
              requestTimeoutMs: 5000,
              reductionLogPath: "./test-reductions.jsonl",
              logLevel: "info",
              disableProgress: true,
            };

            const deps = createMockDeps({
              config,
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
                listRunningModels: vi.fn(async () => []),
              },
              chunker: new Chunker(mockGenerate),
              capabilityRouter: new CapabilityRouter({}, primaryModel),
            });

            const handler = createQueryHandler(deps);
            const result = await handler({ prompt });

            // The response should mention the first fallback model
            expect(result.content[0].text).toContain(
              `[FALLBACK: ${firstFallback} used due to resource exhaustion on ${primaryModel}]`
            );
            // The second fallback should NOT have been used
            expect(modelsUsed).not.toContain(secondFallback);
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );

  it(
    "skips fallback model if it is the same as the primary model",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          async (prompt) => {
            const primaryModel = "llama3";
            // fallbackModels contains the same model as primary — should be skipped
            // and since there are no other fallbacks, should throw
            const mockGenerate = vi.fn(
              async (req: GenerateRequest): Promise<GenerateResponse> => {
                if (req.model === primaryModel) {
                  throw new OllamaError("out of memory", "local_resource_exhausted");
                }
                return { model: req.model, response: "ok", context: [], done: true };
              }
            );

            const config: BridgeConfig = {
              ollamaBaseUrl: "http://localhost:11434",
              defaultModel: primaryModel,
              contextWindow: 4096,
              keepAlive: "10m",
              keepAliveOnStart: false,
              allowedDirs: [process.cwd()],
              allowedDirsExplicit: false,
              systemPrompt: "",
              capabilityMap: {},
              fallbackModels: [primaryModel], // same as primary — should be skipped
              queueMaxSize: 10,
              numParallel: 1,
              requestTimeoutMs: 5000,
              reductionLogPath: "./test-reductions.jsonl",
              logLevel: "info",
              disableProgress: true,
            };

            const deps = createMockDeps({
              config,
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
                listRunningModels: vi.fn(async () => []),
              },
              chunker: new Chunker(mockGenerate),
              capabilityRouter: new CapabilityRouter({}, primaryModel),
            });

            const handler = createQueryHandler(deps);

            let thrownError: unknown;
            try {
              await handler({ prompt });
            } catch (err) {
              thrownError = err;
            }

            // Should have thrown because the only fallback was the same as primary
            expect(thrownError).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );
});
