# Requirements Document

## Introduction

The `ollama-mcp-bridge` is an MCP (Model Context Protocol) server that acts as an intelligent delegation bridge between large LLM models (such as Claude or Codex) and a local model running in Ollama. Its purpose is to allow the orchestrating model to delegate token-expensive or privacy-sensitive tasks — such as bulk file review, log analysis, or directory scanning — to the local model, receiving only the relevant result. This reduces token consumption by the main model and keeps sensitive data within the local environment.

## Glossary

- **Bridge**: The `ollama-mcp-bridge` MCP server, the central component of the system.
- **Orchestrator**: The large LLM model (e.g., Claude, Codex) that acts as the MCP client and delegates tasks to the Bridge.
- **Ollama**: Local LLM model inference service, accessible at `localhost:11434`.
- **Local_Model**: The LLM model running inside Ollama that processes the delegated tasks.
- **MCP_Tool**: A function exposed by the Bridge to the Orchestrator through the MCP protocol.
- **Chunk**: A text fragment resulting from splitting an input that exceeds the Local_Model's context limit.
- **Context_Window**: The maximum token limit that the Local_Model can process in a single call.
- **Task**: A processing request sent by the Orchestrator to the Bridge (e.g., file review, log analysis).
- **Payload**: The input content sent to the Local_Model for processing.
- **Reduction**: The ratio of output tokens to input tokens for a given invocation, used to measure token savings achieved by delegating to the Local_Model.
- **Keep-Alive**: A mechanism to prevent the Local_Model from being evicted from Ollama's memory during periods of inactivity.
- **System_Prompt**: A set of instructions prepended to every Payload that guides the Local_Model toward token-efficient, structured responses.
- **Map-Reduce**: A two-phase chunking strategy where each Chunk is independently summarized (Map), and the resulting summaries are then synthesized into a final response (Reduce), avoiding context window overflow from accumulated history.
- **Allowed_Dirs**: The set of directories the Bridge is permitted to read files from, used to prevent path traversal attacks.
- **Capability_Map**: A configurable routing table that maps task type keywords or patterns to specific Local_Model names, enabling automatic model selection based on task content.
- **.bridgeignore**: A configuration file using gitignore syntax that specifies files and directories the Bridge should exclude when scanning directories for context.

---

## Requirements

### Requirement 1: Exposing MCP Tools to the Orchestrator

**User Story:** As an Orchestrator, I want to discover and call MCP tools from the Bridge, so that I can delegate heavy tasks without leaving the conversation flow.

#### Acceptance Criteria

1. THE Bridge SHALL expose at least one MCP_Tool named `query_local_model` through the standard MCP protocol.
2. THE Bridge SHALL describe each MCP_Tool with a name, description, and input parameter schema in JSON Schema format.
3. WHEN the Orchestrator invokes `query_local_model`, THE Bridge SHALL accept the parameters `prompt` (string, required), `model` (string, optional), and `context_files` (array of paths, optional).
4. WHEN the Orchestrator invokes `query_local_model`, THE Bridge SHALL return the Local_Model's response as plain text in the `content` field of the MCP response.
5. IF the Orchestrator sends parameters with incorrect types, THEN THE Bridge SHALL return an MCP error with code `invalid_params` and a descriptive message.

---

### Requirement 2: Communication with Ollama

**User Story:** As a Bridge, I want to communicate with the local Ollama service, so that I can send tasks to the Local_Model and retrieve its responses.

#### Acceptance Criteria

1. THE Bridge SHALL connect to the Ollama service at the base URL `http://localhost:11434` by default.
2. WHERE the environment variable `OLLAMA_BASE_URL` is configured, THE Bridge SHALL use that value as the base URL instead of the default.
3. WHEN the Bridge sends a Task to the Local_Model, THE Bridge SHALL use the `/api/generate` endpoint of the Ollama API.
4. WHEN the Local_Model completes processing, THE Bridge SHALL return the complete response to the Orchestrator without truncating the content.
5. IF the Ollama service is unavailable at the time of invocation, THEN THE Bridge SHALL return an error with the message "Ollama not available at {url}" and code `service_unavailable`.
6. IF the requested Local_Model does not exist in Ollama, THEN THE Bridge SHALL return an error with the message "Model '{model}' not found in Ollama" and code `model_not_found`.
7. WHEN the Bridge sends sequential Chunks to the Local_Model during the Map phase, THE Bridge SHALL pass the Ollama `context` token array only within the same logical session, and SHALL reset it to null at the start of each new Map phase, as defined in Requirement 4.

---

### Requirement 3: Reading and Processing Local Files

**User Story:** As a developer, I want the Bridge to read files from the local file system and include them in the context sent to Ollama, so that I can delegate bulk code reviews without exposing the content to the Orchestrator.

#### Acceptance Criteria

1. WHEN `context_files` contains file paths, THE Bridge SHALL read the content of each file from the local file system before building the Payload.
2. WHEN the Bridge reads files, THE Bridge SHALL include the file name and its content in the Payload sent to the Local_Model, using the format: `### File: {path}\n{content}`.
3. IF a path in `context_files` does not exist or is not accessible, THEN THE Bridge SHALL include a warning in the Payload indicating `### File: {path}\n[ERROR: file not found]` and continue processing the remaining files.
4. IF `context_files` contains a path to a directory, THEN THE Bridge SHALL recursively list the text files within that directory up to a maximum depth of 3 levels and include them in the Payload.
5. THE Bridge SHALL support text files with UTF-8 encoding.
6. THE Bridge SHALL validate that every path in `context_files` resolves to a location within the current working directory or within a list of explicitly allowed directories configured via the environment variable `BRIDGE_ALLOWED_DIRS` (comma-separated absolute paths).
7. IF a resolved path falls outside all allowed directories, THEN THE Bridge SHALL reject that path with an error entry `### File: {path}\n[SECURITY ERROR: path outside allowed directories]` in the Payload and log a warning to stderr, without reading the file.
8. THE Bridge SHALL resolve all symlinks before performing the allowed-directory check to prevent symlink-based traversal attacks.
9. WHERE `BRIDGE_ALLOWED_DIRS` is not configured, THE Bridge SHALL default to allowing only the current working directory (`process.cwd()` or equivalent).

---

### Requirement 4: Context Window Management (Chunking)

**User Story:** As a Bridge, I want to split Payloads that exceed the Local_Model's context limit, so that I can process large inputs without context overflow errors.

#### Acceptance Criteria

1. THE Bridge SHALL calculate the estimated token size of the Payload before sending it to the Local_Model, using the approximation of 1 token ≈ 4 characters.
2. WHEN the Payload exceeds the configured Context_Window limit, THE Bridge SHALL split the Payload into Chunks that do not exceed 90% of the Context_Window limit.
3. WHEN the Bridge processes multiple Chunks of a single large input, THE Bridge SHALL apply a Map-Reduce strategy: first summarize each Chunk independently (Map phase), then send all partial summaries as a single consolidated input to the Local_Model for a final synthesis (Reduce phase), rather than passing accumulated text history between Chunk calls.
4. WHEN the Bridge performs the Map phase, THE Bridge SHALL pass the Ollama `context` token array returned by each `/api/generate` call only within the same logical session (i.e., sequential turns on the same document), and SHALL reset the context array to null at the start of each new Map phase to avoid KV-cache pollution across unrelated Chunks.
5. WHEN the Reduce phase input (all partial summaries combined) exceeds the Context_Window limit, THE Bridge SHALL apply the Map-Reduce strategy recursively until the final synthesis fits within the Context_Window.
6. WHEN all Chunks have been processed, THE Bridge SHALL consolidate the partial responses into a single final response and return it to the Orchestrator.
7. WHERE the environment variable `OLLAMA_CONTEXT_WINDOW` is configured, THE Bridge SHALL use that value as the Context_Window limit instead of the default of 4096 tokens.
8. FOR ALL valid Payloads, splitting into Chunks and processing sequentially SHALL produce a result that is semantically equivalent to processing the complete Payload in a single call (chunking consistency property).

---

### Requirement 5: Ollama Model Selection

**User Story:** As an Orchestrator, I want to specify which local model to use for each task, so that I can choose the most appropriate model based on the task type and available resources.

#### Acceptance Criteria

1. WHEN the Orchestrator invokes `query_local_model` without specifying the `model` parameter, THE Bridge SHALL use the model configured in the `OLLAMA_DEFAULT_MODEL` environment variable.
2. IF the `OLLAMA_DEFAULT_MODEL` environment variable is not configured and the Orchestrator does not specify `model`, THEN THE Bridge SHALL use `llama3` as the default model.
3. WHEN the Orchestrator specifies the `model` parameter, THE Bridge SHALL use that value for the Ollama call, ignoring the default model.
4. THE Bridge SHALL expose an additional MCP_Tool named `list_local_models` that returns the list of models available in the local Ollama service.

---

### Requirement 6: MCP Server Configuration and Deployment

**User Story:** As a developer, I want to configure and run the Bridge as a standard MCP server, so that I can easily integrate it with MCP clients such as Claude Desktop or Kiro.

#### Acceptance Criteria

1. THE Bridge SHALL implement the MCP protocol using the official MCP SDK for the selected language (TypeScript or Python).
2. THE Bridge SHALL support `stdio` transport as the default MCP communication mechanism.
3. THE Bridge SHALL read its configuration from environment variables at initialization time.
4. WHEN the Bridge initializes successfully, THE Bridge SHALL log to stderr the message "ollama-mcp-bridge started. Default model: {model}. Ollama URL: {url}".
5. IF a required environment variable has an invalid value at initialization, THEN THE Bridge SHALL log a descriptive error message to stderr and exit with exit code 1.
6. THE Bridge SHALL include an example configuration file (`config.example.json` or `.env.example`) with all supported environment variables and their default values documented.

---

### Requirement 7: Observability and Traceability

**User Story:** As a developer, I want the Bridge to log relevant information about each invocation, so that I can diagnose issues and monitor local model usage.

#### Acceptance Criteria

1. WHEN the Bridge receives an invocation of `query_local_model`, THE Bridge SHALL log to stderr: the invoked tool, the model used, the number of files in `context_files`, and the estimated Payload size in tokens.
2. WHEN the Local_Model completes processing, THE Bridge SHALL log to stderr the response time in milliseconds.
3. WHEN the Payload is split into Chunks, THE Bridge SHALL log to stderr the total number of Chunks generated and the processing progress (e.g., "Processing chunk 2/5").
4. IF an error occurs during processing, THE Bridge SHALL log to stderr the error type, the message, and the tool that originated it.
5. WHERE the environment variable `BRIDGE_LOG_LEVEL` is configured with the value `debug`, THE Bridge SHALL include in the logs the full content of the Payload sent to Ollama.

---

### Requirement 8: Model Technical Benchmark

**User Story:** As a developer, I want to run a comparative benchmark on the models available in Ollama, so that I can choose the most appropriate model based on the type of task to delegate.

#### Acceptance Criteria

1. THE Bridge SHALL expose an MCP_Tool named `benchmark_models` through the standard MCP protocol.
2. WHEN the Orchestrator invokes `benchmark_models`, THE Bridge SHALL accept the parameters `models` (array of strings, optional) and `iterations` (positive integer, optional, default 1).
3. WHEN `models` is not specified, THE Bridge SHALL run the benchmark against all models available in the local Ollama service.
4. WHEN the benchmark runs, THE Bridge SHALL evaluate each model with a set of representative tasks that includes at least: code summarization, log analysis, and file review.
5. WHEN the Bridge evaluates each model per task, THE Bridge SHALL measure and record: latency in milliseconds, throughput in tokens per second, and the length of the generated response as a completeness indicator.
6. WHEN all tasks have been evaluated, THE Bridge SHALL consolidate the results into a comparative report in table format with a model ranking per use case.
7. WHEN the `iterations` parameter is greater than 1, THE Bridge SHALL run each task the specified number of iterations and report the mean and standard deviation of each metric.
8. WHEN the benchmark finishes, THE Bridge SHALL return the comparative report as text to the Orchestrator.
9. WHERE the environment variable `BENCHMARK_OUTPUT_FILE` is configured, THE Bridge SHALL save the complete benchmark result to that file in JSON format.
10. IF a model fails during the benchmark, THEN THE Bridge SHALL record the error in the report with status `ERROR` and continue evaluating the remaining models.

---

### Requirement 9: Configuration Validator

**User Story:** As a developer, I want to validate the Bridge configuration before using it in production, so that I can detect connectivity or configuration issues in advance.

#### Acceptance Criteria

1. THE Bridge SHALL expose an MCP_Tool named `test_config` through the standard MCP protocol.
2. WHEN the Orchestrator invokes `test_config`, THE Bridge SHALL run the following checks in order: Ollama connectivity, existence and availability of the default model, end-to-end call with a minimal prompt, and correctness of the chunking mechanism with a synthetic Payload.
3. WHEN the Bridge verifies Ollama connectivity, THE Bridge SHALL ping the service and record the response time in milliseconds.
4. WHEN the Bridge verifies the default model, THE Bridge SHALL confirm that the model exists in Ollama's list of available models and that it responds to an inference call.
5. WHEN the Bridge runs the end-to-end call, THE Bridge SHALL send the prompt `"Reply only: OK"` to the Local_Model and verify that the response is not empty.
6. WHEN the Bridge verifies chunking, THE Bridge SHALL construct a synthetic Payload that exceeds the Context_Window limit and confirm that the split-and-consolidate mechanism produces a coherent response.
7. WHEN all checks have been executed, THE Bridge SHALL return a status report that includes the result (✅ or ❌), the response time, and a descriptive message for each check.
8. WHEN the Orchestrator invokes `test_config` with the `dry_run` parameter set to `true`, THE Bridge SHALL run all checks that do not require real calls to Ollama and mark the skipped checks with status `SKIPPED`.
9. IF any check fails, THEN THE Bridge SHALL include in the report the detailed error message and a resolution suggestion for that check.

---

### Requirement 10: MCP Configuration Snippet Generator (CLI)

**User Story:** As a developer, I want a CLI command that generates the correct MCP configuration JSON snippet for my chosen client, so that I can integrate the Bridge by copying and pasting a single block without risking corruption of my client's config file.

#### Acceptance Criteria

1. THE Bridge SHALL provide a CLI command `generate-config` executable as `npx ollama-mcp-bridge generate-config` / `python -m ollama_mcp_bridge generate-config`.
2. WHEN the `generate-config` command runs, THE Bridge SHALL accept a `--client` flag with supported values: `claude-desktop`, `claude-code`, `kiro`, `cursor`, and `generic`.
3. WHEN `--client` is specified, THE Bridge SHALL output to stdout the exact JSON snippet that must be added to that client's MCP configuration file, pre-filled with the current environment variable values (or defaults if not set).
4. THE Bridge SHALL include in the output a comment block (or surrounding text) that specifies the exact file path where the snippet must be placed for each supported client, based on the detected operating system (Windows, macOS, Linux).
5. WHEN the `generate-config` command runs with the `--env` flag followed by key=value pairs, THE Bridge SHALL use those values to populate the snippet instead of reading from the current environment.
6. THE Bridge SHALL output the snippet in a format that is valid JSON and can be directly copy-pasted into the target configuration file.
7. WHEN the `--client` flag is omitted, THE Bridge SHALL output snippets for all supported clients sequentially, each preceded by a header identifying the client and the target file path.
8. THE Bridge SHALL include a `--test` flag that, after generating the snippet, runs `test_config` to verify the current Bridge setup is working, without modifying any files.

---

### Requirement 11: Token-Saving System Prompt for Local Model

**User Story:** As an Orchestrator, I want the Bridge to inject a token-saving system prompt into every Ollama call, so that the Local_Model returns compressed, dense, actionable output that minimizes token consumption on the Orchestrator side.

#### Acceptance Criteria

1. THE Bridge SHALL inject a default system prompt into every call to the Local_Model that instructs it to return only essential information, without preamble or filler phrases (e.g., "Sure!", "Of course!", "Here is...").
2. THE Bridge SHALL include in the default system prompt an instruction to use structured formats (bullet points, key:value pairs, short code blocks) over prose paragraphs when possible.
3. WHEN the task is a code review, THE Bridge SHALL include in the default system prompt an instruction to return only findings (issues, risks, suggestions) and omit any description of what the code does.
4. WHEN the task is a log analysis, THE Bridge SHALL include in the default system prompt an instruction to return only anomalies, errors, and patterns, and omit any summary of normal operations.
5. WHEN the task is a file summarization, THE Bridge SHALL include in the default system prompt an instruction to return a maximum of 3 to 5 lines of dense summary.
6. THE Bridge SHALL include in the default system prompt an instruction to omit any explanation of the Local_Model's own reasoning process.
7. WHERE the environment variable `BRIDGE_SYSTEM_PROMPT` is configured, THE Bridge SHALL use that value as the system prompt instead of the default.
8. WHEN the Orchestrator invokes `query_local_model` with a `system_prompt` parameter, THE Bridge SHALL use that value as the system prompt for that invocation, overriding both the default and the `BRIDGE_SYSTEM_PROMPT` environment variable.
9. THE Bridge SHALL include the estimated token count of the active system prompt in the Payload size calculation used for chunking decisions (Requirement 4).

---

### Requirement 12: Reduction Log

**User Story:** As a developer, I want the Bridge to record a structured log of every delegation interaction, so that I can audit token savings, understand which tasks benefit most from delegation, and tune the system prompt over time.

#### Acceptance Criteria

1. WHEN the Bridge completes an invocation of `query_local_model`, THE Bridge SHALL append a reduction record to the reduction log file containing: timestamp, tool invoked, model used, estimated input token count, estimated output token count, reduction ratio (output tokens / input tokens), task type (if detectable), and whether chunking was used.
2. THE Bridge SHALL store reduction records in a structured append-only JSON Lines file (`.jsonl`), with one JSON object per line.
3. WHERE the environment variable `BRIDGE_REDUCTION_LOG` is configured, THE Bridge SHALL use that value as the path for the reduction log file instead of the default path `./ollama-bridge-reductions.jsonl`.
4. THE Bridge SHALL write reduction records in a non-blocking, fire-and-forget manner so that log writes do not delay or block the response returned to the Orchestrator.
5. THE Bridge SHALL expose an MCP_Tool named `get_reduction_stats` that reads the reduction log file and returns aggregate statistics including: total number of invocations, average reduction ratio, total tokens saved (sum of input tokens minus output tokens across all records), and a breakdown of invocations and average reduction ratio by model and by task type.
6. WHERE the environment variable `BRIDGE_LOG_LEVEL` is set to `debug`, THE Bridge SHALL include the first 200 characters of both the input Payload and the output response in each reduction record.
7. THE Bridge SHALL write reduction records to the `.jsonl` file defined in this requirement and SHALL NOT write reduction records to the observability stderr log defined in Requirement 7.


---

### Requirement 13: Model Keep-Alive

**User Story:** As a developer, I want the Bridge to keep the Local_Model warm in Ollama's memory, so that I avoid cold-start latency on every delegation request.

#### Acceptance Criteria

1. THE Bridge SHALL pass a `keep_alive` parameter in every request to the `/api/generate` endpoint, using the value configured in the environment variable `OLLAMA_KEEP_ALIVE` (default: `"10m"`).
2. WHERE `OLLAMA_KEEP_ALIVE` is set to `"0"`, THE Bridge SHALL pass that value to Ollama to instruct it to unload the model from memory immediately after the request completes.
3. WHERE `OLLAMA_KEEP_ALIVE` is set to `"-1"`, THE Bridge SHALL pass that value to Ollama to instruct it to keep the model loaded in memory indefinitely.
4. THE Bridge SHALL expose an MCP_Tool named `ping_model` that accepts a `model` parameter (string, optional, defaults to the configured default model) and sends a minimal keep-alive request to Ollama, returning the model's load status and the round-trip response time in milliseconds.
5. WHEN the Bridge initializes AND the environment variable `BRIDGE_KEEPALIVE_ON_START` is set to `"true"`, THE Bridge SHALL send a keep-alive ping to the default model before accepting any client requests, so that the model is pre-loaded into memory.
6. WHEN the Bridge sends a request to the Local_Model, THE Bridge SHALL log to stderr whether the model responded as a warm start (already loaded) or a cold start (required loading), including the response time in milliseconds for each case.

---

### Requirement 14: Capability Mapping (Task-to-Model Routing)

**User Story:** As an Orchestrator, I want the Bridge to automatically route tasks to the most capable local model for that task type, so that I get better results without having to specify the model on every call.

#### Acceptance Criteria

1. THE Bridge SHALL support a capability map: a configuration that associates task type keywords or patterns with specific Ollama model names (e.g., "review" → `codellama`, "log" → `mistral`, "summarize" → `llama3`).
2. WHERE the environment variable `BRIDGE_CAPABILITY_MAP` is configured as a JSON string, THE Bridge SHALL parse it as a map of pattern → model name at initialization time.
3. WHEN the Orchestrator invokes `query_local_model` without specifying a `model`, THE Bridge SHALL scan the `prompt` text against the capability map patterns (case-insensitive substring match) and use the first matching model.
4. WHEN multiple patterns match the prompt, THE Bridge SHALL use the model associated with the first matching pattern in the order they appear in the capability map.
5. IF no pattern matches and no `model` is specified, THEN THE Bridge SHALL fall back to the default model resolution defined in Requirement 5.
6. THE Bridge SHALL expose an MCP_Tool named `get_capability_map` that returns the current capability map configuration and the resolved model for a given prompt (accepts a `prompt` parameter for testing routing).
7. WHEN the Bridge routes a task via capability map, THE Bridge SHALL log to stderr the matched pattern and the selected model.

---

### Requirement 15: MCP Progress Notifications (Streaming)

**User Story:** As an Orchestrator, I want to receive real-time progress updates while the Bridge is processing a long task, so that I know the Bridge is active and can estimate completion time.

#### Acceptance Criteria

1. THE Bridge SHALL implement MCP progress notifications to send incremental status updates to the Orchestrator during long-running operations.
2. WHEN the Bridge begins processing a `query_local_model` invocation, THE Bridge SHALL send an initial progress notification with status "started" and the estimated number of Chunks (if chunking applies).
3. WHEN the Bridge completes each Chunk during a Map-Reduce operation, THE Bridge SHALL send a progress notification indicating the current Chunk index, total Chunks, and elapsed time in milliseconds.
4. WHEN the Bridge enters the Reduce phase of a Map-Reduce operation, THE Bridge SHALL send a progress notification with status "reducing" and the number of partial summaries being consolidated.
5. WHEN the Bridge reads files from `context_files`, THE Bridge SHALL send a progress notification for each file read, including the file name and its estimated token size.
6. IF the Ollama service takes longer than 30 seconds to respond to a single request, THEN THE Bridge SHALL send a progress notification with status "waiting" and the elapsed time, to indicate the Bridge is still active.
7. WHERE the environment variable `BRIDGE_DISABLE_PROGRESS` is set to `"true"`, THE Bridge SHALL suppress all progress notifications, for clients that do not support MCP notifications.

---

### Requirement 16: .bridgeignore File Support

**User Story:** As a developer, I want the Bridge to respect an ignore file when scanning directories, so that binary files, build artifacts, and irrelevant directories are never sent to Ollama.

#### Acceptance Criteria

1. THE Bridge SHALL look for a `.bridgeignore` file in the current working directory when processing `context_files` that include directory paths.
2. WHEN a `.bridgeignore` file is found, THE Bridge SHALL parse it using the same pattern syntax as `.gitignore` (glob patterns, `#` comments, negation with `!`).
3. WHEN scanning a directory, THE Bridge SHALL exclude any file or subdirectory that matches a pattern in `.bridgeignore`.
4. THE Bridge SHALL always exclude binary files (files that contain null bytes or non-UTF-8 sequences) regardless of `.bridgeignore` contents, and log a warning to stderr for each excluded binary file.
5. THE Bridge SHALL include a default set of always-ignored patterns equivalent to: `node_modules/`, `.git/`, `dist/`, `build/`, `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.svg`, `*.ico`, `*.pdf`, `*.zip`, `*.tar`, `*.gz`, `*.exe`, `*.bin`, `*.lock`.
6. IF no `.bridgeignore` file is found, THEN THE Bridge SHALL apply only the default always-ignored patterns from criterion 16.5.
7. WHEN a file is excluded due to `.bridgeignore` or binary detection, THE Bridge SHALL log to stderr the file path and the reason for exclusion.

---

### Requirement 17: VRAM / Memory Exhaustion Handling

**User Story:** As a developer, I want the Bridge to gracefully handle out-of-memory errors from Ollama, so that a single resource-exhausted GPU does not cause the entire delegation to fail silently.

#### Acceptance Criteria

1. WHEN Ollama returns an error response that contains the substrings `"out of memory"`, `"CUDA out of memory"`, `"not enough memory"`, or an HTTP 500 status with a memory-related body, THE Bridge SHALL classify the error as `local_resource_exhausted`.
2. WHEN a `local_resource_exhausted` error is detected, THE Bridge SHALL attempt one automatic retry using a fallback model before returning an error to the Orchestrator.
3. THE Bridge SHALL support a configurable fallback model chain via the environment variable `BRIDGE_FALLBACK_MODELS` as a comma-separated ordered list of model names (e.g., `"llama3:8b,phi3:mini,tinyllama"`).
4. WHEN retrying with a fallback model, THE Bridge SHALL select the first model from `BRIDGE_FALLBACK_MODELS` that is available in the local Ollama service and is different from the model that caused the error.
5. WHEN the Bridge retries with a fallback model, THE Bridge SHALL log to stderr the original model name, the error type `local_resource_exhausted`, and the fallback model selected.
6. WHEN the Bridge retries with a fallback model, THE Bridge SHALL include a warning prefix in the response returned to the Orchestrator in the format `[FALLBACK: {fallback_model} used due to resource exhaustion on {original_model}]`.
7. IF no fallback model is available or all fallback models also fail with `local_resource_exhausted`, THEN THE Bridge SHALL return an MCP error with code `local_resource_exhausted` and a message listing all attempted models.
8. WHERE `BRIDGE_FALLBACK_MODELS` is not configured, THE Bridge SHALL return the `local_resource_exhausted` error immediately to the Orchestrator without attempting any automatic retry.

> **Glossary addition — Fallback_Model**: A smaller or less resource-intensive Local_Model used as a substitute when the primary model fails due to memory exhaustion.

---

### Requirement 18: Request Concurrency Queue

**User Story:** As a developer, I want the Bridge to queue concurrent requests when Ollama is busy, so that parallel tool invocations from the Orchestrator do not time out or fail due to Ollama's sequential processing nature.

#### Acceptance Criteria

1. THE Bridge SHALL maintain an internal FIFO Request_Queue for all incoming `query_local_model` invocations, ensuring that only one request is sent to Ollama at a time by default.
2. WHEN a new invocation arrives while Ollama is processing a previous request, THE Bridge SHALL enqueue the new invocation and send a progress notification (per Requirement 15) to the Orchestrator indicating the queue position (e.g., `"Queued: position 2 of 3"`).
3. THE Bridge SHALL support a configurable maximum queue size via the environment variable `BRIDGE_QUEUE_MAX_SIZE` (default: `10`).
4. IF the queue is full when a new invocation arrives, THEN THE Bridge SHALL return an MCP error with code `queue_full` and a message indicating the current queue size and the configured maximum.
5. WHERE the environment variable `OLLAMA_NUM_PARALLEL` is configured with a value greater than `1`, THE Bridge SHALL allow up to that number of concurrent requests to be sent to Ollama simultaneously, adjusting the concurrency limit of the Request_Queue accordingly.
6. THE Bridge SHALL support a configurable per-request timeout via the environment variable `BRIDGE_REQUEST_TIMEOUT_MS` (default: `300000` ms / 5 minutes), after which a queued or in-flight request is cancelled and THE Bridge SHALL return an MCP error with code `request_timeout`.
7. WHEN a request is dequeued and sent to Ollama, THE Bridge SHALL log to stderr the queue wait time in milliseconds for that request.
8. THE Bridge SHALL expose the current queue status — queue length, number of active requests, and configured concurrency limit — as part of the response of the `test_config` tool defined in Requirement 9.

> **Glossary addition — Request_Queue**: An internal FIFO queue that serializes concurrent Orchestrator invocations to match Ollama's sequential processing model, preventing connection timeouts under parallel load.
