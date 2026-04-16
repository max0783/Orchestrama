# Implementation Plan: Dual Console Separation

## Overview

Strip `src/server.ts` to expose only the two query tools, then build the Human Console as a new `src/console/` module that reuses all existing handler factories. Add pure formatting helpers and a menu module, wire everything together, and update `package.json`. All 12 correctness properties are covered by property-based tests placed close to the code they validate.

## Tasks

- [-] 1. Strip `src/server.ts` to expose only `query_local_model` and `ping_model`
  - Remove the five admin tool definitions (`list_local_models`, `get_reduction_stats`, `get_capability_map`, `benchmark_models`, `test_config`) from the `TOOL_DEFINITIONS` array
  - Remove the corresponding `case` branches from the `CallTool` switch statement
  - Remove the five admin handler imports (`createListModelsHandler`, `createReductionStatsHandler`, `createCapabilityMapHandler`, `createBenchmarkHandler`, `createTestConfigHandler`) and their instantiation calls
  - Verify the existing `default: throw new McpError(ErrorCode.MethodNotFound, ...)` branch is still in place — no new code needed
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [-] 1.1 Write property test: MCP server exposes exactly two tools (Property 1)
    - **Property 1: MCP server exposes exactly the two query tools**
    - Import `TOOL_DEFINITIONS` from the stripped `server.ts` (or extract it to a testable module) and assert the array has length 2 and contains exactly `"query_local_model"` and `"ping_model"`
    - **Validates: Requirements 1.1, 1.2, 1.4**

  - [~] 1.2 Write property test: MCP server rejects all non-query tool names (Property 2)
    - **Property 2: MCP server rejects all non-query tool names**
    - Use `fc.string()` filtered to exclude `"query_local_model"` and `"ping_model"`; assert that dispatching any such name through the `CallTool` switch throws `McpError` with `ErrorCode.MethodNotFound`
    - **Validates: Requirements 1.3**

- [~] 2. Create `src/console/formatters.ts` with pure formatting functions
  - Implement `formatModelList(models: string[]): string` — each model name on its own line; empty list returns a "no models" message
  - Implement `formatPingResult(model: string, result: { loaded: boolean; responseTimeMs: number }): string` — contains model name, `"warm"` or `"cold"`, and the numeric response time in ms
  - Implement `formatConfig(config: BridgeConfig): string` — contains every field name and its string representation; formats `capabilityMap` entries as `pattern → model` pairs
  - Implement `formatCapabilityMap(map: CapabilityMap, resolved?: { prompt: string; model: string }): string` — lists every pattern→model pair; if `resolved` is provided, appends the resolved model name
  - Implement `formatReductionStats(stats: ReductionStats): string` — contains `totalInvocations`, `averageReductionRatio` as a percentage, `totalTokensSaved`, and every key from `byModel` and `byTaskType`
  - Implement `formatCheckResults(checks: CheckResult[]): string` — `✅` for PASS, `❌` for FAIL, `⏭️` for SKIPPED; includes resolution hint for every FAIL that has one; lists all failed check names in a summary when at least one fails
  - Implement `formatReductionRatio(ratio: number): string` — returns `(ratio * 100).toFixed(1) + "%"`
  - _Requirements: 3.2, 5.1, 5.2, 5.4, 6.1, 6.2, 6.4, 7.2, 7.5_

  - [~] 2.1 Write property test: list models output contains all model names (Property 4)
    - **Property 4: List models output contains all available model names**
    - Use `fc.array(fc.string({ minLength: 1 }), { minLength: 1 })`; assert every model name appears in `formatModelList(models)`
    - **Validates: Requirements 3.1**

  - [~] 2.2 Write property test: ping output contains status and response time (Property 5)
    - **Property 5: Ping output contains status and response time**
    - Use `fc.record({ model: fc.string({ minLength: 1 }), loaded: fc.boolean(), responseTimeMs: fc.nat() })`; assert output contains the model name, `"warm"` or `"cold"`, and the numeric response time
    - **Validates: Requirements 3.2**

  - [~] 2.3 Write property test: config display contains all BridgeConfig fields (Property 8)
    - **Property 8: Config display contains all BridgeConfig fields and capability map entries**
    - Use `fc.record(...)` matching the `BridgeConfig` shape; assert every field name and every `capabilityMap` pattern→model pair appears in `formatConfig(config)`
    - **Validates: Requirements 5.1, 5.2**

  - [~] 2.4 Write property test: capability map resolve shows resolved model (Property 9)
    - **Property 9: Capability map resolve shows the resolved model**
    - Use `fc.record({ map: fc.dictionary(fc.string(), fc.string()), prompt: fc.string() })`; assert `formatCapabilityMap(map, { prompt, model: resolved })` contains the resolved model name
    - **Validates: Requirements 5.4**

  - [~] 2.5 Write property test: reduction stats display contains all fields (Property 10)
    - **Property 10: Reduction stats display contains all aggregate fields and breakdowns**
    - Use `fc.record(...)` matching `ReductionStats`; assert output contains `totalInvocations`, the average ratio as a percentage, `totalTokensSaved`, and every key from `byModel` and `byTaskType`
    - **Validates: Requirements 6.1, 6.2**

  - [~] 2.6 Write property test: reduction ratio formatted as percentage (Property 11)
    - **Property 11: Reduction ratio is formatted as a percentage**
    - Use `fc.float({ min: 0, max: 1 })`; assert `formatReductionRatio(r) === (r * 100).toFixed(1) + "%"`
    - **Validates: Requirements 6.4**

  - [~] 2.7 Write property test: health check display shows correct indicators (Property 12)
    - **Property 12: Health check display shows correct indicators and lists all failures**
    - Use `fc.array(fc.record({ name: fc.string(), status: fc.constantFrom("PASS", "FAIL", "SKIPPED"), message: fc.string(), resolution: fc.option(fc.string()) }))`; assert `✅`/`❌`/`⏭️` per status, resolution hints for FAILs, and all failed names in summary
    - **Validates: Requirements 7.2, 7.5**

  - [~] 2.8 Write unit tests for formatters
    - Test `formatModelList` with empty array, single model, multiple models
    - Test `formatPingResult` for warm and cold results
    - Test `formatConfig` with an empty capability map and a populated one
    - Test `formatCapabilityMap` with and without a resolved prompt
    - Test `formatReductionStats` with zero invocations and with populated `byModel`/`byTaskType`
    - Test `formatCheckResults` with all-pass, all-fail, mixed, and SKIPPED results
    - Test `formatReductionRatio` for boundary values `0`, `0.5`, `1`
    - _Requirements: 3.2, 5.1, 5.2, 5.4, 6.1, 6.2, 6.4, 7.2, 7.5_

- [~] 3. Create `src/console/menu.ts` with menu rendering and selection parsing
  - Define the `MenuAction` union type covering all 10 actions: `"list_models"`, `"ping_model"`, `"set_default_model"`, `"run_benchmark"`, `"view_config"`, `"view_capability_map"`, `"view_reduction_stats"`, `"test_config"`, `"test_config_dry"`, `"exit"`
  - Implement `renderMenu(): string` — returns the full menu string with all 10 numbered entries (1–9 and 0 for exit)
  - Implement `parseSelection(input: string): MenuAction | null` — maps `"1"`–`"9"` and `"0"` to the correct `MenuAction`; returns `null` for any other input
  - _Requirements: 2.2, 2.3_

  - [~] 3.1 Write property test: every valid selection invokes a handler (Property 3)
    - **Property 3: Every valid menu selection invokes a handler and produces output**
    - Use `fc.integer({ min: 1, max: 9 })`; assert `parseSelection(String(n))` returns a non-null `MenuAction` for every value in range; assert `parseSelection("0")` returns `"exit"`
    - **Validates: Requirements 2.4**

  - [~] 3.2 Write unit tests for menu module
    - Verify `renderMenu()` contains all 10 action labels
    - Verify `parseSelection()` maps each of `"0"`–`"9"` to the correct `MenuAction`
    - Verify `parseSelection()` returns `null` for empty string, letters, and out-of-range numbers
    - _Requirements: 2.2, 2.3_

- [~] 4. Checkpoint — ensure all tests pass so far
  - Run `npm test` and confirm all existing tests still pass and the new formatter/menu tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [~] 5. Create `src/console/index.ts` as the interactive Human Console entry point
  - Load config via `loadConfig()` at startup
  - Instantiate all shared dependencies: `OllamaClient`, `ReductionLogger`, `CapabilityRouter`, `Chunker`, `RequestQueue`
  - Instantiate all admin handler factories: `createListModelsHandler`, `createPingHandler`, `createBenchmarkHandler`, `createTestConfigHandler`, `createReductionStatsHandler`, `createCapabilityMapHandler`
  - Implement the main menu loop using `readline.createInterface({ input: process.stdin, output: process.stdout })`
  - Dispatch each `MenuAction` to the appropriate handler; format and print output using functions from `formatters.ts`
  - Implement `set_default_model`: prompt for a model name, reject empty input with `"Model name cannot be empty."`, then set `config.defaultModel` and `process.env.OLLAMA_DEFAULT_MODEL`
  - Implement `run_benchmark`: prompt for optional comma-separated model names and optional iteration count; display a progress indicator while running
  - Implement `view_capability_map`: display the map and optionally prompt for a test prompt to resolve
  - Handle all errors gracefully: catch handler errors, display `Error: <message>`, return to menu without crashing
  - Handle `SIGINT` / readline `close` event as an exit request: call `rl.close()` and `process.exit(0)`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [~] 5.1 Write property test: set default model updates the session env var (Property 6)
    - **Property 6: Set default model updates the session default**
    - Use `fc.string({ minLength: 1 })`; call the `set_default_model` action logic directly with a generated model name and assert `process.env.OLLAMA_DEFAULT_MODEL` equals that string afterwards; restore the original value after each run
    - **Validates: Requirements 3.3**

  - [~] 5.2 Write property test: benchmark report contains all model names (Property 7)
    - **Property 7: Benchmark report is displayed for any result**
    - Use `fc.array(fc.record({ model: fc.string({ minLength: 1 }), tasks: fc.array(fc.anything()), status: fc.option(fc.constant("ERROR")), error: fc.option(fc.string()) }), { minLength: 1 })`; assert `formatBenchmarkReport` (or the equivalent formatter) contains every model name
    - **Validates: Requirements 4.2, 4.4**

- [~] 6. Update `package.json` with `"console"` script and `"bridge-console"` bin entry
  - Add `"console": "node dist/console/index.js"` to the `"scripts"` section
  - Add `"bridge-console": "dist/console/index.js"` to the `"bin"` section alongside the existing entries
  - _Requirements: 9.1, 9.2_

  - [~] 6.1 Write unit test: package.json contains required script and bin entries
    - Read `package.json` and assert `scripts.console` equals `"node dist/console/index.js"` and `bin["bridge-console"]` equals `"dist/console/index.js"`
    - _Requirements: 9.1, 9.2_

- [~] 7. Verify backward compatibility
  - Run `npm run build` and confirm `dist/console/index.js` is produced without errors (no separate build step needed — `tsconfig.json` already includes `src/**/*`)
  - Run the full test suite (`npm test`) and confirm all pre-existing tests still pass without modification
  - Confirm `TOOL_DEFINITIONS` in the stripped `server.ts` has exactly 2 entries (covered by Property 1 test from task 1.1)
  - Confirm the `CallTool` switch has no `case` branches for the 5 admin tools (covered by Property 2 test from task 1.2)
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.3, 9.4_

- [~] 8. Final checkpoint — ensure all tests pass
  - Run `npm test` and confirm the complete test suite passes, including all new property-based and unit tests
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use the existing `fast-check` library already in `devDependencies`
- All 12 correctness properties from the design are covered by property-based test sub-tasks
- The console uses Node.js built-in `readline` — no new runtime dependencies are introduced
- `src/console/formatters.ts` contains only pure functions, making it the primary target for property-based testing
- `src/console/menu.ts` is kept separate from `index.ts` to remain independently testable
