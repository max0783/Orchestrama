# Implementation Plan: ollama-mcp-bridge

## Overview

Implement the `ollama-mcp-bridge` MCP server in TypeScript (Node.js). The build proceeds bottom-up: core utilities first, then the Ollama HTTP client, file reader, chunker, routing, system prompt, queue, logging, and finally the MCP tool layer that wires everything together.

## Tasks

- [x] 1. Project scaffold and core types
  - Initialize `package.json` with dependencies: `@modelcontextprotocol/sdk`, `ignore`, `p-queue`, `fast-check` (dev), `vitest` (dev), `typescript` (dev)
  - Create `tsconfig.json` targeting Node 18, `strict: true`, `outDir: dist`
  - Create `src/types.ts` with all shared interfaces: `BridgeConfig`, `GenerateRequest`, `GenerateResponse`, `FileReadResult`, `ChunkResult`, `ReductionRecord`, `QueueStatus`, `CapabilityMap`, `TaskType`
  - Create `.env.example` documenting all environment variables with defaults
  - _Requirements: 6.1, 6.3, 6.6_

- [x] 2. Configuration loader (`src/config.ts`)
  - [x] 2.1 Implement `loadConfig()` that reads all env vars, validates types, and returns a `BridgeConfig`
    - Parse `BRIDGE_CAPABILITY_MAP` as JSON; on parse error log to stderr and use `{}`
    - On invalid required env var, log descriptive error and `process.exit(1)`
    - _Requirements: 6.3, 6.5, 14.2_

  - [x] 2.2 Write unit tests for `loadConfig`
    - Test defaults, valid overrides, invalid JSON capability map, invalid numeric values
    - _Requirements: 6.3, 6.5_

- [x] 3. Ollama HTTP client (`src/ollama/client.ts`)
  - [x] 3.1 Implement `OllamaClient` with `generate()`, `listModels()`, and `ping()` methods using Node built-in `fetch`
    - `generate()` sends POST `/api/generate`, always includes `keep_alive` field
    - Classify errors: connection refused → `service_unavailable`; model not found → `model_not_found`; HTTP 500 + memory keywords → `local_resource_exhausted`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 13.1, 13.2, 13.3_

  - [x] 3.2 Write property test for keep-alive field presence (Property 14)
    - **Property 14: Keep-alive field presence**
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [x] 3.3 Write unit tests for error classification
    - Test each OOM substring variant, 404 model-not-found, connection refused
    - _Requirements: 2.5, 2.6, 17.1_

- [x] 4. File reader (`src/files/reader.ts`)
  - [x] 4.1 Implement `FileReader` with `readContextFiles()` and `formatForPayload()`
    - Resolve symlinks via `fs.realpath`, check against `allowedDirs`
    - Recurse directories up to depth 3, apply `.bridgeignore` + default ignore patterns using `ignore` package
    - Detect binary files (null bytes / non-UTF-8), exclude with stderr warning
    - Format output as `### File: {path}\n{content}`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [x] 4.2 Write property test for file payload formatting (Property 4)
    - **Property 4: File payload formatting**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 4.3 Write property test for security rejection (Property 5)
    - **Property 5: Security rejection for out-of-bounds paths**
    - **Validates: Requirements 3.6, 3.7, 3.8**

  - [x] 4.4 Write property test for missing file error marker (Property 6)
    - **Property 6: Missing file error marker**
    - **Validates: Requirements 3.3**

  - [x] 4.5 Write property test for .bridgeignore pattern exclusion (Property 17)
    - **Property 17: .bridgeignore pattern exclusion**
    - **Validates: Requirements 16.2, 16.3**

  - [x] 4.6 Write property test for binary file exclusion (Property 18)
    - **Property 18: Binary file exclusion**
    - **Validates: Requirements 16.4**

  - [x] 4.7 Write unit tests for file reader
    - Test directory recursion depth limit, default ignore patterns, symlink traversal rejection
    - _Requirements: 3.4, 3.8, 16.5_

- [x] 5. Chunker / Map-Reduce engine (`src/chunking/`)
  - [x] 5.1 Implement `estimateTokens(text: string): number` as `Math.floor(text.length / 4)`
    - _Requirements: 4.1_

  - [x] 5.2 Write property test for token estimation formula (Property 7)
    - **Property 7: Token estimation formula**
    - **Validates: Requirements 4.1**

  - [x] 5.3 Implement `splitIntoChunks()` that splits payload into chunks ≤ `contextWindow * 0.9` tokens
    - _Requirements: 4.2_

  - [x] 5.4 Write property test for chunk size invariant (Property 8)
    - **Property 8: Chunk size invariant**
    - **Validates: Requirements 4.2**

  - [x] 5.5 Implement `Chunker.process()` with Map-Reduce strategy, recursive Reduce phase, and 10-level recursion guard
    - Reset Ollama `context` to `null` at the start of each Map phase
    - Emit progress notifications via `onProgress` callback
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 5.6 Write property test for Map-phase context isolation (Property 3)
    - **Property 3: Map-phase context isolation**
    - **Validates: Requirements 2.7, 4.4**

  - [x] 5.7 Write property test for chunking termination and completeness (Property 9)
    - **Property 9: Chunking termination and completeness**
    - **Validates: Requirements 4.5, 4.8**

- [x] 6. Capability map router (`src/routing/capability_map.ts`)
  - [x] 6.1 Implement `CapabilityRouter` with `resolveModel()` using case-insensitive first-match logic and `getMap()`
    - Resolution order: explicit model → capability map first match → default model → `"llama3"`
    - Log matched pattern and selected model to stderr
    - _Requirements: 5.1, 5.2, 5.3, 14.1, 14.2, 14.3, 14.4, 14.5, 14.7_

  - [x] 6.2 Write property test for model resolution precedence (Property 10)
    - **Property 10: Model resolution precedence**
    - **Validates: Requirements 5.1, 5.2, 5.3, 14.3, 14.4, 14.5**

  - [x] 6.3 Write property test for capability map first-match routing (Property 15)
    - **Property 15: Capability map first-match routing**
    - **Validates: Requirements 14.3, 14.4, 14.5**

- [x] 7. System prompt injector (`src/prompts/system_prompt.ts`)
  - [x] 7.1 Implement `SystemPromptInjector` with `detect()` and `build()` methods
    - `detect()` maps prompt keywords to `TaskType`
    - `build()` returns task-type-specific system prompt with required instruction keywords
    - Override precedence: `system_prompt` param → `BRIDGE_SYSTEM_PROMPT` env → built-in default
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x] 7.2 Write property test for system prompt task-type coverage (Property 11)
    - **Property 11: System prompt task-type coverage**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6**

  - [x] 7.3 Write property test for system prompt override precedence (Property 12)
    - **Property 12: System prompt override precedence**
    - **Validates: Requirements 11.7, 11.8**

- [x] 8. Request queue (`src/queue/request_queue.ts`)
  - [x] 8.1 Implement `RequestQueue` wrapping `p-queue` with queue-full rejection, per-request timeout cancellation, and `getStatus()`
    - Respect `OLLAMA_NUM_PARALLEL` as concurrency limit
    - Log queue wait time to stderr on dequeue
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x] 8.2 Write property test for FIFO queue ordering (Property 20)
    - **Property 20: FIFO queue ordering**
    - **Validates: Requirements 18.1**

  - [x] 8.3 Write property test for queue-full rejection (Property 21)
    - **Property 21: Queue-full rejection**
    - **Validates: Requirements 18.4**

- [x] 9. Reduction logger (`src/logging/reduction_logger.ts`)
  - [x] 9.1 Implement `ReductionLogger` with fire-and-forget `append()` and `readStats()`
    - Write JSONL records non-blocking via `setImmediate` / async append
    - `readStats()` returns aggregate statistics: total invocations, average reduction ratio, total tokens saved, breakdown by model and task type
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 9.2 Write property test for reduction record completeness (Property 13)
    - **Property 13: Reduction record completeness**
    - **Validates: Requirements 12.1, 12.2**

- [x] 10. Progress notifier (`src/notifications/progress.ts`)
  - [x] 10.1 Implement `ProgressNotifier` wrapping MCP server notification API; no-op when `BRIDGE_DISABLE_PROGRESS=true`
    - Methods: `started`, `chunkDone`, `reducing`, `fileRead`, `waiting`, `queued`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 10.2 Write property test for progress notification count during Map-Reduce (Property 16)
    - **Property 16: Progress notification count during Map-Reduce**
    - **Validates: Requirements 15.2, 15.3**

- [x] 11. Checkpoint — wire core modules and run unit tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. MCP tool: `query_local_model` (`src/tools/query.ts`)
  - [x] 12.1 Implement the `query_local_model` tool handler
    - Validate input schema; return `invalid_params` on type errors
    - Resolve model via `CapabilityRouter`, build system prompt via `SystemPromptInjector`
    - Read context files via `FileReader`, estimate tokens including system prompt
    - Enqueue via `RequestQueue`; on `local_resource_exhausted` retry with fallback chain from `BRIDGE_FALLBACK_MODELS`
    - Process payload via `Chunker`, append reduction record, return response
    - Log invocation details to stderr (tool, model, file count, token estimate, response time)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2, 7.3, 7.4, 11.9, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_

  - [x] 12.2 Write property test for response pass-through integrity (Property 1)
    - **Property 1: Response pass-through integrity**
    - **Validates: Requirements 1.4, 2.4**

  - [x] 12.3 Write property test for invalid parameter rejection (Property 2)
    - **Property 2: Invalid parameter rejection**
    - **Validates: Requirements 1.5**

  - [x] 12.4 Write property test for OOM error classification and fallback (Property 19)
    - **Property 19: OOM error classification and fallback**
    - **Validates: Requirements 17.1, 17.2, 17.4**

  - [x] 12.5 Write property test for invocation log fields (Property 23)
    - **Property 23: Invocation log fields**
    - **Validates: Requirements 7.1**

- [x] 13. MCP tool: `list_local_models` (`src/tools/list_models.ts`)
  - Implement handler that calls `OllamaClient.listModels()` and returns the list as text
  - _Requirements: 5.4_

- [x] 14. MCP tool: `ping_model` (`src/tools/ping.ts`)
  - Implement handler that sends a minimal keep-alive request and returns load status + round-trip time
  - Log warm/cold start status to stderr
  - _Requirements: 13.4, 13.6_

- [x] 15. MCP tool: `get_reduction_stats` (`src/tools/reduction_stats.ts`)
  - Implement handler that calls `ReductionLogger.readStats()` and returns formatted aggregate statistics
  - _Requirements: 12.5_

- [x] 16. MCP tool: `get_capability_map` (`src/tools/capability_map.ts`)
  - Implement handler that returns current capability map and resolves model for an optional `prompt` parameter
  - _Requirements: 14.6_

- [x] 17. MCP tool: `benchmark_models` (`src/tools/benchmark.ts`)
  - [x] 17.1 Implement handler that runs code summarization, log analysis, and file review tasks against each model
    - Measure latency (ms), throughput (tokens/s), response length per task
    - Support `iterations > 1` with mean and standard deviation reporting
    - On model failure record `status: "ERROR"` and continue
    - Save JSON results to `BENCHMARK_OUTPUT_FILE` if configured
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

  - [x] 17.2 Write property test for benchmark report completeness (Property 22)
    - **Property 22: Benchmark report completeness**
    - **Validates: Requirements 8.5, 8.6, 8.10**

- [x] 18. MCP tool: `test_config` (`src/tools/test_config.ts`)
  - Implement handler running checks in order: Ollama connectivity, default model existence, end-to-end call with `"Reply only: OK"`, chunking mechanism with synthetic payload, queue status
  - Support `dry_run: true` to skip real Ollama calls (mark as `SKIPPED`)
  - Return structured report with ✅/❌, response time, message, and resolution suggestion per check
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 18.8_

- [x] 19. MCP server entry point (`src/server.ts`)
  - [x] 19.1 Bootstrap MCP server with stdio transport, register all tools, load config, optionally pre-load model on start
    - Log startup message: `"ollama-mcp-bridge started. Default model: {model}. Ollama URL: {url}"`
    - If `BRIDGE_KEEPALIVE_ON_START=true`, ping default model before accepting requests
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 13.5_

- [x] 20. CLI entry point (`src/cli/generate_config.ts`)
  - Implement `generate-config` command with `--client`, `--env`, and `--test` flags
  - Output valid JSON snippets for `claude-desktop`, `claude-code`, `kiro`, `cursor`, `generic` with OS-specific file path comments
  - When `--test` is passed, invoke `test_config` after generating the snippet
  - Wire as `bin` entry in `package.json`
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 21. Final checkpoint — full test suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with minimum 100 iterations; all Ollama calls are mocked
- Integration tests (against a real Ollama instance) are in `src/__tests__/integration/` and are skipped when `OLLAMA_BASE_URL` is not set
