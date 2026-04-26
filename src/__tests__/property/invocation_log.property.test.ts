// Feature: orchestrama, Property 23: Invocation log fields
// For any `query_local_model` invocation with known parameters, the stderr log
// output should contain the tool name, the resolved model name, the number of
// files in `context_files`, and the estimated payload token count.
//
// **Validates: Requirements 7.1**

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fc from "fast-check";
import { createQueryHandler } from "../../tools/query.js";
import { Chunker } from "../../chunking/index.js";
import { CapabilityRouter } from "../../routing/capability_map.js";
import { SystemPromptInjector } from "../../prompts/system_prompt.js";
import { RequestQueue } from "../../queue/request_queue.js";
import { ProgressNotifier } from "../../notifications/progress.js";
import { estimateTokens } from "../../chunking/index.js";
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
// Property 23: Invocation log fields
// ---------------------------------------------------------------------------

describe("Property 23: Invocation log fields", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "stderr log contains tool name, model name, file count, and token estimate",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Non-empty prompt
          fc.string({ minLength: 1, maxLength: 300 }),
          // Number of context files (0 to 5)
          fc.integer({ min: 0, max: 5 }),
          // Explicit model name (optional)
          fc.option(
            fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== ""),
            { nil: undefined }
          ),
          async (prompt, fileCount, explicitModel) => {
            // Build fake file read results
            const fakeFiles: FileReadResult[] = Array.from(
              { length: fileCount },
              (_, i) => ({
                path: `/fake/file${i}.txt`,
                content: "fake content",
                tokenEstimate: 3,
              })
            );

            // Build the fake formatted payload that fileReader.formatForPayload returns
            const fakeFilePayload = fakeFiles
              .map((f) => `### File: ${f.path}\n${f.content}`)
              .join("\n\n");

            const mockGenerate = vi.fn(
              async (_req: GenerateRequest): Promise<GenerateResponse> => ({
                model: explicitModel ?? "llama3",
                response: "ok",
                context: [],
                done: true,
              })
            );

            const fileReader = {
              readContextFiles: vi.fn(
                async (_paths: string[]): Promise<FileReadResult[]> => fakeFiles
              ),
              formatForPayload: vi.fn(
                (_results: FileReadResult[]): string => fakeFilePayload
              ),
            };

            const resolvedModel = explicitModel ?? "llama3";
            const capabilityRouter = new CapabilityRouter({}, "llama3");

            const deps = createMockDeps({
              ollamaClient: {
                generate: mockGenerate,
                listModels: vi.fn(async () => []),
                ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
                listRunningModels: vi.fn(async () => []),
              },
              chunker: new Chunker(mockGenerate),
              fileReader,
              capabilityRouter,
            });

            // Capture stderr output
            const stderrChunks: string[] = [];
            const stderrSpy = vi
              .spyOn(process.stderr, "write")
              .mockImplementation((chunk: unknown) => {
                stderrChunks.push(String(chunk));
                return true;
              });

            try {
              const args: Record<string, unknown> = { prompt };
              if (fileCount > 0) {
                args.context_files = fakeFiles.map((f) => f.path);
              }
              if (explicitModel !== undefined) {
                args.model = explicitModel;
              }

              await createQueryHandler(deps)(args);
            } finally {
              stderrSpy.mockRestore();
            }

            const allStderr = stderrChunks.join("");

            // Compute expected token estimate (same formula as query.ts)
            const fullPayload =
              fakeFilePayload.length > 0
                ? `${fakeFilePayload}\n\n${prompt}`
                : prompt;
            const systemPromptInjector = new SystemPromptInjector("");
            const taskType = systemPromptInjector.detect(prompt);
            const systemPrompt = systemPromptInjector.build(taskType, undefined);
            const tokenEstimate = estimateTokens(fullPayload + systemPrompt);

            // Verify all required fields appear in stderr
            expect(allStderr).toContain("query_local_model");
            expect(allStderr).toContain(`model=${resolvedModel}`);
            expect(allStderr).toContain(`files=${fileCount}`);
            expect(allStderr).toContain(`tokens=${tokenEstimate}`);
          }
        ),
        { numRuns: 100 }
      );
    },
    30_000
  );

  it(
    "stderr log contains the resolved model name (not the explicit model parameter key)",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== ""),
          async (prompt, modelName) => {
            const mockGenerate = vi.fn(
              async (_req: GenerateRequest): Promise<GenerateResponse> => ({
                model: modelName,
                response: "ok",
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
                listRunningModels: vi.fn(async () => []),
              },
              chunker: new Chunker(mockGenerate),
              capabilityRouter: new CapabilityRouter({}, modelName),
            });

            const stderrChunks: string[] = [];
            const stderrSpy = vi
              .spyOn(process.stderr, "write")
              .mockImplementation((chunk: unknown) => {
                stderrChunks.push(String(chunk));
                return true;
              });

            try {
              await createQueryHandler(deps)({ prompt });
            } finally {
              stderrSpy.mockRestore();
            }

            const allStderr = stderrChunks.join("");
            expect(allStderr).toContain(`model=${modelName}`);
          }
        ),
        { numRuns: 100 }
      );
    },
    15_000
  );
});
