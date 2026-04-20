// Feature: smart-mcp-self-description, Property 3: Explicit model overrides pattern model preference
// For any matched UsagePattern that specifies a `modelPreference` and any non-empty explicit
// `model` parameter, the resolved model used for the query SHALL equal the explicit `model`
// parameter, not the pattern's `modelPreference`.
//
// **Validates: Requirements 1.4**

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
import type { DispatchResult } from "../../patterns/dispatcher.js";
import type { IntentDispatcher } from "../../patterns/dispatcher.js";

// ---------------------------------------------------------------------------
// createMockDeps helper (mirrors response_passthrough.property.test.ts)
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
    fallbackModels: [],
    queueMaxSize: 10,
    numParallel: 1,
    requestTimeoutMs: 5000,
    reductionLogPath: "./test-reductions.jsonl",
    logLevel: "info",
    disableProgress: true,
  };

  const mockGenerate = vi.fn(async (req: GenerateRequest): Promise<GenerateResponse> => ({
    model: req.model,
    response: "mock response",
    context: [],
    done: true,
  }));

  const ollamaClient = {
    generate: mockGenerate,
    listModels: vi.fn(async () => []),
    ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
    showModel: vi.fn(async () => ({
      parameters: "",
      details: {},
      modelInfoRaw: {},
      parsedParameters: {},
    })),
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

  // Default no-op intent dispatcher (no match)
  const intentDispatcher: IntentDispatcher = {
    resolve: vi.fn((_intent: string): DispatchResult | null => null),
  } as unknown as IntentDispatcher;

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
    intentDispatcher,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 3: Explicit model overrides pattern model preference
// ---------------------------------------------------------------------------

describe("Property 3: Explicit model overrides pattern model preference", () => {
  it(
    "uses the explicit model parameter, not the pattern modelPreference, when both are provided",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // patternModelPreference: a non-empty model name string
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          // explicitModel: a different non-empty model name string
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          // prompt: a non-empty string
          fc.string({ minLength: 1, maxLength: 200 }),
          // intent: a non-empty string (the mock dispatcher will always match it)
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          async (patternModelPreference, explicitModel, prompt, intent) => {
            // Track which model was actually used in the generate call
            const capturedModels: string[] = [];

            const mockGenerate = vi.fn(
              async (req: GenerateRequest): Promise<GenerateResponse> => {
                capturedModels.push(req.model);
                return {
                  model: req.model,
                  response: "mock response",
                  context: [],
                  done: true,
                };
              }
            );

            // Mock IntentDispatcher that always returns a pattern with patternModelPreference
            const mockIntentDispatcher: IntentDispatcher = {
              resolve: vi.fn((_i: string): DispatchResult | null => ({
                pattern: {
                  name: "mock-pattern",
                  description: "A mock pattern for testing",
                  systemPrompt: "You are a mock assistant.",
                  modelPreference: patternModelPreference,
                  keywords: ["mock"],
                  isBuiltIn: false,
                },
                matchedBy: "name",
              })),
            } as unknown as IntentDispatcher;

            const deps = createMockDeps({
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                showModel: vi.fn(async () => ({
                  parameters: "",
                  details: {},
                  modelInfoRaw: {},
                  parsedParameters: {},
                })),
                listRunningModels: vi.fn(async () => []),
              },
              chunker: new Chunker(mockGenerate),
              intentDispatcher: mockIntentDispatcher,
            });

            const handler = createQueryHandler(deps);
            await handler({ prompt, model: explicitModel, intent });

            // The generate call must have used explicitModel, not patternModelPreference
            expect(capturedModels.length).toBeGreaterThan(0);
            for (const usedModel of capturedModels) {
              expect(usedModel).toBe(explicitModel);
              expect(usedModel).not.toBe(patternModelPreference);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );

  it(
    "uses the pattern modelPreference when no explicit model is provided",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // patternModelPreference: a non-empty model name string
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          // prompt: a non-empty string
          fc.string({ minLength: 1, maxLength: 200 }),
          // intent: a non-empty string
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          async (patternModelPreference, prompt, intent) => {
            const capturedModels: string[] = [];

            const mockGenerate = vi.fn(
              async (req: GenerateRequest): Promise<GenerateResponse> => {
                capturedModels.push(req.model);
                return {
                  model: req.model,
                  response: "mock response",
                  context: [],
                  done: true,
                };
              }
            );

            // Mock IntentDispatcher that always returns a pattern with patternModelPreference
            const mockIntentDispatcher: IntentDispatcher = {
              resolve: vi.fn((_i: string): DispatchResult | null => ({
                pattern: {
                  name: "mock-pattern",
                  description: "A mock pattern for testing",
                  systemPrompt: "You are a mock assistant.",
                  modelPreference: patternModelPreference,
                  keywords: ["mock"],
                  isBuiltIn: false,
                },
                matchedBy: "name",
              })),
            } as unknown as IntentDispatcher;

            const deps = createMockDeps({
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                showModel: vi.fn(async () => ({
                  parameters: "",
                  details: {},
                  modelInfoRaw: {},
                  parsedParameters: {},
                })),
                listRunningModels: vi.fn(async () => []),
              },
              chunker: new Chunker(mockGenerate),
              intentDispatcher: mockIntentDispatcher,
              // Use a CapabilityRouter that passes through the hint model unchanged
              capabilityRouter: new CapabilityRouter({}, patternModelPreference),
            });

            const handler = createQueryHandler(deps);
            // No explicit model — pattern preference should be used
            await handler({ prompt, intent });

            // The generate call must have used patternModelPreference
            expect(capturedModels.length).toBeGreaterThan(0);
            for (const usedModel of capturedModels) {
              expect(usedModel).toBe(patternModelPreference);
            }
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );
});
