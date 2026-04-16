// Feature: ollama-mcp-bridge, Property 23: Invocation log fields
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
// ---------------------------------------------------------------------------
// createMockDeps helper
// ---------------------------------------------------------------------------
function createMockDeps(overrides) {
    const config = {
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
    const mockGenerate = vi.fn(async (_req) => ({
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
        readContextFiles: vi.fn(async (_paths) => []),
        formatForPayload: vi.fn((_results) => ""),
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
    const progressNotifier = new ProgressNotifier(() => { }, true);
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
// Property 23: Invocation log fields
// ---------------------------------------------------------------------------
describe("Property 23: Invocation log fields", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it("stderr log contains tool name, model name, file count, and token estimate", async () => {
        await fc.assert(fc.asyncProperty(
        // Non-empty prompt
        fc.string({ minLength: 1, maxLength: 300 }), 
        // Number of context files (0 to 5)
        fc.integer({ min: 0, max: 5 }), 
        // Explicit model name (optional)
        fc.option(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== ""), { nil: undefined }), async (prompt, fileCount, explicitModel) => {
            // Build fake file read results
            const fakeFiles = Array.from({ length: fileCount }, (_, i) => ({
                path: `/fake/file${i}.txt`,
                content: "fake content",
                tokenEstimate: 3,
            }));
            // Build the fake formatted payload that fileReader.formatForPayload returns
            const fakeFilePayload = fakeFiles
                .map((f) => `### File: ${f.path}\n${f.content}`)
                .join("\n\n");
            const mockGenerate = vi.fn(async (_req) => ({
                model: explicitModel ?? "llama3",
                response: "ok",
                context: [],
                done: true,
            }));
            const fileReader = {
                readContextFiles: vi.fn(async (_paths) => fakeFiles),
                formatForPayload: vi.fn((_results) => fakeFilePayload),
            };
            const resolvedModel = explicitModel ?? "llama3";
            const capabilityRouter = new CapabilityRouter({}, "llama3");
            const deps = createMockDeps({
                ollamaClient: {
                    generate: mockGenerate,
                    listModels: vi.fn(async () => []),
                    ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                    showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
                },
                chunker: new Chunker(mockGenerate),
                fileReader,
                capabilityRouter,
            });
            // Capture stderr output
            const stderrChunks = [];
            const stderrSpy = vi
                .spyOn(process.stderr, "write")
                .mockImplementation((chunk) => {
                stderrChunks.push(String(chunk));
                return true;
            });
            try {
                const args = { prompt };
                if (fileCount > 0) {
                    args.context_files = fakeFiles.map((f) => f.path);
                }
                if (explicitModel !== undefined) {
                    args.model = explicitModel;
                }
                await createQueryHandler(deps)(args);
            }
            finally {
                stderrSpy.mockRestore();
            }
            const allStderr = stderrChunks.join("");
            // Compute expected token estimate (same formula as query.ts)
            const fullPayload = fakeFilePayload.length > 0
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
        }), { numRuns: 100 });
    }, 30_000);
    it("stderr log contains the resolved model name (not the explicit model parameter key)", async () => {
        await fc.assert(fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== ""), async (prompt, modelName) => {
            const mockGenerate = vi.fn(async (_req) => ({
                model: modelName,
                response: "ok",
                context: [],
                done: true,
            }));
            const deps = createMockDeps({
                ollamaClient: {
                    generate: mockGenerate,
                    listModels: vi.fn(async () => []),
                    ping: vi.fn(async () => ({ loaded: true, responseTimeMs: 10 })),
                    showModel: vi.fn(async () => ({ parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} })),
                },
                chunker: new Chunker(mockGenerate),
                capabilityRouter: new CapabilityRouter({}, modelName),
            });
            const stderrChunks = [];
            const stderrSpy = vi
                .spyOn(process.stderr, "write")
                .mockImplementation((chunk) => {
                stderrChunks.push(String(chunk));
                return true;
            });
            try {
                await createQueryHandler(deps)({ prompt });
            }
            finally {
                stderrSpy.mockRestore();
            }
            const allStderr = stderrChunks.join("");
            expect(allStderr).toContain(`model=${modelName}`);
        }), { numRuns: 100 });
    }, 15_000);
});
//# sourceMappingURL=invocation_log.property.test.js.map