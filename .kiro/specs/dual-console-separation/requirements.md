# Requirements Document

## Introduction

The ollama-mcp-bridge currently exposes all tools — including administrative ones like `benchmark_models`, `test_config`, `get_reduction_stats`, `get_capability_map`, and `list_local_models` — through the MCP server interface. This means AI orchestrators (Kiro, Claude, Cursor, etc.) can see and invoke tools that are intended only for the human operator.

This feature separates the bridge into two distinct interfaces:

1. **MCP Console** — the existing stdio-based MCP server, stripped down to expose only the tools an AI orchestrator legitimately needs for query routing (`query_local_model` and `ping_model`).
2. **Human Console** — a new interactive CLI/TUI that the human operator runs directly to manage models, run benchmarks, inspect configuration, and view reduction statistics.

The goal is a clean separation of concerns: the AI sees only what it needs to do its job; the human operator has a dedicated, ergonomic interface for administration.

---

## Glossary

- **MCP_Server**: The stdio-based Model Context Protocol server process (`src/server.ts`) consumed by AI orchestrators.
- **Human_Console**: The new interactive CLI/TUI process (`src/console/index.ts`) run directly by the human operator.
- **Orchestrator**: An AI agent (Kiro, Claude Desktop, Cursor, etc.) that connects to the MCP_Server via the MCP protocol.
- **Operator**: The human user who manages the bridge installation, models, and configuration.
- **Admin_Tool**: A tool intended exclusively for the Operator — `benchmark_models`, `test_config`, `get_reduction_stats`, `get_capability_map`, `list_local_models`.
- **Query_Tool**: A tool intended for use by the Orchestrator — `query_local_model`, `ping_model`.
- **Capability_Map**: The JSON mapping of task-type keywords to specific Ollama model names, stored in `BRIDGE_CAPABILITY_MAP`.
- **Reduction_Log**: The JSONL file recording token-reduction statistics per invocation, at `BRIDGE_REDUCTION_LOG`.
- **BridgeConfig**: The configuration object populated from environment variables at startup.

---

## Requirements

### Requirement 1: MCP Server Tool Restriction

**User Story:** As an Orchestrator, I want the MCP server to expose only the tools I need for query routing, so that I am not confused or distracted by administrative tools that are not relevant to my task.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose exactly two tools: `query_local_model` and `ping_model`.
2. WHEN an Orchestrator calls `ListTools`, THE MCP_Server SHALL return only `query_local_model` and `ping_model` in the tools array.
3. WHEN an Orchestrator calls `CallTool` with a tool name other than `query_local_model` or `ping_model`, THE MCP_Server SHALL return an MCP `MethodNotFound` error.
4. THE MCP_Server SHALL NOT expose `benchmark_models`, `test_config`, `get_reduction_stats`, `get_capability_map`, or `list_local_models` through the MCP protocol.
5. THE MCP_Server SHALL preserve all existing behaviour of `query_local_model` and `ping_model` without modification.

---

### Requirement 2: Human Console Entry Point

**User Story:** As an Operator, I want a dedicated command I can run in my terminal to access all administrative functions, so that I have a single, discoverable place to manage the bridge.

#### Acceptance Criteria

1. THE Human_Console SHALL be launchable via `node dist/console/index.js` (or an npm script alias such as `npm run console`).
2. WHEN launched, THE Human_Console SHALL display a top-level menu listing all available administrative actions.
3. THE Human_Console SHALL accept keyboard input to navigate and select menu items.
4. WHEN the Operator selects an action, THE Human_Console SHALL execute that action and display the result before returning to the menu.
5. WHEN the Operator chooses to exit, THE Human_Console SHALL terminate cleanly with exit code 0.
6. THE Human_Console SHALL read configuration from the same environment variables as the MCP_Server (via `loadConfig()`).

---

### Requirement 3: Model Management in Human Console

**User Story:** As an Operator, I want to list and enable/disable models from the Human Console, so that I can control which models are available for routing without editing config files manually.

#### Acceptance Criteria

1. WHEN the Operator selects "List Models", THE Human_Console SHALL display all models currently available in the local Ollama instance.
2. WHEN the Operator selects "Ping Model", THE Human_Console SHALL prompt for a model name (defaulting to the configured default model) and display the warm/cold status and round-trip response time.
3. WHEN the Operator selects "Set Default Model", THE Human_Console SHALL prompt for a model name and update the `OLLAMA_DEFAULT_MODEL` environment variable for the current session.
4. IF the Ollama instance is unreachable when listing models, THE Human_Console SHALL display a descriptive error message and return to the menu without crashing.

---

### Requirement 4: Benchmark Runner in Human Console

**User Story:** As an Operator, I want to run benchmarks from the Human Console and view the results in a readable format, so that I can compare models and make informed routing decisions.

#### Acceptance Criteria

1. WHEN the Operator selects "Run Benchmark", THE Human_Console SHALL prompt for an optional comma-separated list of model names and an optional iteration count.
2. WHEN the Operator confirms, THE Human_Console SHALL execute the benchmark using the existing `createBenchmarkHandler` logic and display the formatted report.
3. WHILE a benchmark is running, THE Human_Console SHALL display a progress indicator showing which model and task are currently being evaluated.
4. IF a model fails during benchmarking, THE Human_Console SHALL display the error for that model and continue benchmarking the remaining models.
5. WHERE `BENCHMARK_OUTPUT_FILE` is configured, THE Human_Console SHALL save the JSON benchmark report to that file after completion.

---

### Requirement 5: Configuration Viewer in Human Console

**User Story:** As an Operator, I want to view the current bridge configuration from the Human Console, so that I can verify settings without inspecting environment variables manually.

#### Acceptance Criteria

1. WHEN the Operator selects "View Configuration", THE Human_Console SHALL display all `BridgeConfig` fields and their current values in a human-readable format.
2. THE Human_Console SHALL display the Capability_Map entries as a formatted table showing pattern-to-model mappings.
3. THE Human_Console SHALL mask or omit any field that contains a file path to a secrets file, displaying only the path rather than the file contents.
4. WHEN the Operator selects "View Capability Map", THE Human_Console SHALL display the full Capability_Map and optionally resolve a test prompt to show which model would be selected.

---

### Requirement 6: Reduction Statistics in Human Console

**User Story:** As an Operator, I want to view token-reduction statistics from the Human Console, so that I can audit the efficiency of the bridge over time.

#### Acceptance Criteria

1. WHEN the Operator selects "View Reduction Stats", THE Human_Console SHALL read the Reduction_Log and display aggregate statistics: total invocations, average reduction ratio, total tokens saved.
2. THE Human_Console SHALL display per-model and per-task-type breakdowns of invocation counts and average reduction ratios.
3. IF the Reduction_Log file does not exist, THE Human_Console SHALL display a message indicating no stats are available yet and return to the menu.
4. THE Human_Console SHALL format reduction ratios as percentages (e.g. `0.312` displayed as `31.2%`) for readability.

---

### Requirement 7: Configuration Health Check in Human Console

**User Story:** As an Operator, I want to run the full configuration health check from the Human Console, so that I can diagnose bridge issues without needing an AI orchestrator to invoke `test_config`.

#### Acceptance Criteria

1. WHEN the Operator selects "Test Configuration", THE Human_Console SHALL run all five checks: Ollama connectivity, default model existence, end-to-end call, chunking mechanism, and queue status.
2. THE Human_Console SHALL display each check result with a pass/fail/skipped indicator and resolution hint for any failures.
3. WHEN the Operator selects "Test Configuration (dry run)", THE Human_Console SHALL run the health check with `dry_run=true`, skipping checks that make real Ollama calls.
4. IF all checks pass, THE Human_Console SHALL display a summary confirmation message.
5. IF any check fails, THE Human_Console SHALL display a summary failure message and list the failed checks.

---

### Requirement 8: Backward Compatibility

**User Story:** As an Operator, I want the existing setup CLI (`bridge-setup`) to continue working unchanged, so that my existing installation and automation scripts are not broken.

#### Acceptance Criteria

1. THE `bridge-setup` CLI (`src/cli/setup.ts`) SHALL continue to function without modification.
2. THE MCP_Server startup behaviour, environment variable handling, and stdio transport SHALL remain unchanged.
3. THE existing `generate-config` CLI (`src/cli/generate_config.ts`) SHALL continue to function without modification.
4. WHEN the MCP_Server is started, THE MCP_Server SHALL NOT require any new environment variables beyond those already defined in `BridgeConfig`.

---

### Requirement 9: Human Console Packaging

**User Story:** As an Operator, I want the Human Console to be accessible via a short npm script, so that I can launch it without remembering the full file path.

#### Acceptance Criteria

1. THE `package.json` SHALL include a `"console"` script entry that runs `node dist/console/index.js`.
2. WHERE the project is installed globally or as a local dependency, THE `package.json` `bin` field SHALL expose a `bridge-console` binary pointing to `dist/console/index.js`.
3. THE Human_Console SHALL be compiled by the existing TypeScript build (`npm run build`) without requiring a separate build step.
4. THE Human_Console source SHALL reside under `src/console/` to maintain the existing project directory conventions.
