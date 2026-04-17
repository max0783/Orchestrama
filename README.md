# ollama-mcp-bridge

A bridge that connects AI orchestrators (Kiro, Claude Desktop, Cursor) to a local [Ollama](https://ollama.com) instance via the Model Context Protocol (MCP). It exposes two interfaces with distinct audiences:

- **MCP Server** — the stdio-based MCP process consumed by AI orchestrators. Exposes `query_local_model`, `ping_model`, `list_patterns`, `register_pattern`, `get_bridge_limits`, and `setup_bridge`.
- **Human Console** — an interactive CLI for the operator to manage models, tune settings, run benchmarks, and inspect statistics.

---

## Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com) running locally (`ollama serve`)
- At least one model pulled (`ollama pull llama3.1:8b`)

---

## Installation

```bash
npm install
npm run build
```

---

## MCP Server

The MCP server is what your AI orchestrator connects to.

| Tool | Description |
|---|---|
| `query_local_model` | Send a prompt (with optional context files and model options) to a local Ollama model |
| `ping_model` | Check whether a model is warm or cold and measure response time |
| `list_patterns` | List built-in and custom intent patterns |
| `register_pattern` | Register a custom pattern for `intent` routing |
| `get_bridge_limits` | Return enforced context limits and allowed directories |
| `setup_bridge` | Generate client-specific configuration snippet plus usage guide |

### Wiring into Kiro

Add this to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "ollama-mcp-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/dist/server.js"],
      "env": {
        "OLLAMA_DEFAULT_MODEL": "llama3.1:8b"
      }
    }
  }
}
```

### Wiring into Claude Desktop

Add to `claude_desktop_config.json` (path shown by `node dist/cli/generate_config.js --client claude-desktop`):

```json
{
  "mcpServers": {
    "ollama-mcp-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/dist/server.js"],
      "env": {
        "OLLAMA_DEFAULT_MODEL": "llama3.1:8b"
      }
    }
  }
}
```

### Generate config snippets automatically

```bash
# Print snippets for all supported clients
node dist/cli/generate_config.js

# Kiro only, with a custom model, and run a live connectivity check
node dist/cli/generate_config.js --client kiro --env OLLAMA_DEFAULT_MODEL=mistral --test
```

### Smoke-test the server without a client

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/server.js
```

Expected: a JSON response listing all exposed tools.

---

## Human Console

The Human Console is an interactive terminal UI for the operator. Launch it with:

```bash
npm run console
```

### Menu

```
ollama-mcp-bridge Console
─────────────────────────
1. List Models
2. Ping Model
3. Set Default Model
4. Run Benchmark
5. View Configuration
6. View Capability Map
7. View Reduction Stats
8. Test Configuration
9. Test Configuration (dry run)
10. Edit Bridge Limits
11. Edit Model Options
0. Exit
```

Type the number and press Enter. Press `Ctrl+C` at any time to exit.

### Menu options

**1. List Models**
Lists all models currently available in your local Ollama instance.

**2. Ping Model**
Prompts for a model name (leave blank to use the default). Reports warm/cold status and round-trip response time in ms.

**3. Set Default Model**
Updates `OLLAMA_DEFAULT_MODEL` for the current session. After entering the model name, you can optionally set a context window. If you skip the context window picker, the bridge queries Ollama's `/api/show` endpoint and auto-detects the model's native context length (e.g. 32768 for a 32k model). Changes take effect immediately without a restart.

**4. Run Benchmark**
Prompts for model selection, context window, iteration count, and warm-up preference. Runs latency, throughput, and response-length tests and prints a formatted report. If `BENCHMARK_OUTPUT_FILE` is set, the JSON report is also saved to that path.

**5. View Configuration**
Displays all active configuration values, including the capability map, bridge limits, and current model fine-tuning options.

**6. View Capability Map**
Shows the full capability map. Optionally enter a test prompt to see which model would be selected for it.

**7. View Reduction Stats**
Reads the reduction log and displays aggregate statistics: total invocations, average reduction ratio, total tokens saved, and per-model / per-task-type breakdowns.

**8. Test Configuration**
Runs all health checks against your live Ollama instance (connectivity, model existence, end-to-end call, chunking, queue status). Each check shows ✅ / ❌ / ⏭️ with a resolution hint on failure.

**9. Test Configuration (dry run)**
Same as above but skips checks that make real Ollama calls. Useful for verifying config structure without needing Ollama to be running.

**10. Edit Bridge Limits**
Interactively update context limits for the current session:
- `maxContextFiles` — maximum number of `context_files` paths per query
- `maxFileTokens` — maximum estimated tokens per individual context file
- `maxTotalContextTokens` — maximum combined tokens across all context files
- `contextWindow` — token limit before Map-Reduce chunking kicks in

All changes propagate immediately to the running MCP server without a restart.

**11. Edit Model Options**
Interactively set fine-tuning parameters applied to every Ollama call. Enter a number to set a value, press Enter to keep the current value, or type `clear` to reset a field to the model's default. See [Model fine-tuning](#model-fine-tuning) for the full list of parameters.

**0. Exit**
Exits cleanly with code 0.

---

## Configuration

Both the MCP server and the Human Console read the same environment variables. Copy `.env.example` to `.env` and adjust as needed.

### Core settings

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_DEFAULT_MODEL` | `llama3.1:8b` | Model used when none is specified |
| `OLLAMA_CONTEXT_WINDOW` | `4096` | Token limit before Map-Reduce chunking kicks in |
| `OLLAMA_KEEP_ALIVE` | `10m` | How long Ollama keeps the model loaded after a request |
| `OLLAMA_NUM_PARALLEL` | `1` | Number of concurrent Ollama requests |

### Bridge behaviour

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_ALLOWED_DIRS` | current working directory | Comma-separated list of directories the bridge may read files from |
| `BRIDGE_CAPABILITY_MAP` | `{}` | JSON object mapping keyword patterns to model names |
| `BRIDGE_FALLBACK_MODELS` | _(none)_ | Comma-separated fallback models tried on resource exhaustion |
| `BRIDGE_QUEUE_MAX_SIZE` | `10` | Maximum queued requests before new ones are rejected |
| `BRIDGE_REQUEST_TIMEOUT_MS` | `300000` | Per-request timeout in milliseconds |
| `BRIDGE_SYSTEM_PROMPT` | _(built-in)_ | Override the system prompt injected into every query |
| `BRIDGE_REDUCTION_LOG` | `./ollama-bridge-reductions.jsonl` | Path to the token-reduction log file |
| `BRIDGE_LOG_LEVEL` | `info` | `info` or `debug` (debug logs payload previews) |
| `BRIDGE_DISABLE_PROGRESS` | `false` | Set to `true` to suppress MCP progress notifications |
| `BRIDGE_KEEPALIVE_ON_START` | `false` | Set to `true` to pre-warm the default model at startup |

### Context limits

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_MAX_CONTEXT_FILES` | `20` | Maximum number of `context_files` paths per query |
| `BRIDGE_MAX_FILE_TOKENS` | `1024` | Maximum estimated tokens per individual context file |
| `BRIDGE_MAX_TOTAL_CONTEXT_TOKENS` | `4096` | Maximum combined estimated tokens across all context files |

These can also be changed at runtime via **10. Edit Bridge Limits** in the console.

### Model fine-tuning

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_MODEL_OPTIONS` | _(none)_ | JSON object of generation parameters (see below) |

`OLLAMA_MODEL_OPTIONS` accepts a JSON object with any combination of these fields:

| Field | Range | Description |
|---|---|---|
| `temperature` | 0.0–2.0 | Sampling temperature. Lower = more deterministic. |
| `top_p` | 0.0–1.0 | Nucleus sampling probability threshold. |
| `top_k` | integer | Top-k sampling. `0` = disabled. |
| `repeat_penalty` | float | Penalty for repeated tokens. `1.0` = no penalty. |
| `seed` | integer | Fixed random seed for reproducible outputs. `-1` = random. |
| `num_predict` | integer | Maximum tokens to generate. `-1` = model default. |
| `min_p` | 0.0–1.0 | Minimum token probability threshold. |
| `tfs_z` | float | Tail-free sampling parameter. |

These are global defaults. Individual `query_local_model` calls can override them per-call using the `options` parameter. Call-level values take precedence over config-level defaults.

```bash
# Example: deterministic outputs with a fixed seed
OLLAMA_MODEL_OPTIONS={"temperature":0.1,"seed":42}
```

These can also be changed at runtime via **11. Edit Model Options** in the console.

### Benchmark

| Variable | Default | Description |
|---|---|---|
| `BENCHMARK_OUTPUT_FILE` | _(none)_ | If set, benchmark results are saved as JSON to this path |

### Example `.env`

```bash
OLLAMA_DEFAULT_MODEL=qwen2.5:32b
OLLAMA_CONTEXT_WINDOW=32768
OLLAMA_KEEP_ALIVE=30m
OLLAMA_MODEL_OPTIONS={"temperature":0.2,"seed":42}
BRIDGE_CAPABILITY_MAP={"code":"codellama:13b","log":"mistral:7b"}
BRIDGE_MAX_FILE_TOKENS=4096
BRIDGE_MAX_TOTAL_CONTEXT_TOKENS=32768
BRIDGE_LOG_LEVEL=debug
BRIDGE_KEEPALIVE_ON_START=true
BENCHMARK_OUTPUT_FILE=./benchmark-results.json
```

---

## Intent patterns

The `query_local_model` tool accepts an `intent` parameter that selects a pre-configured system prompt optimised for a specific task. Built-in patterns are strictly output-scoped to minimise hallucination.

### Built-in patterns

| Pattern | Keywords | Behaviour |
|---|---|---|
| `code_review` | review, code review, refactor, lint | Returns only a bullet list of findings. No description of what the code does. |
| `explain_code` | explain, what does, how does, understand | Explains purpose and key behaviour in ≤5 sentences. |
| `find_bugs` | bugs, defects, issues, problems | Lists only confirmed or likely bugs with location and reason. |
| `find_ts_errors` | typescript, ts errors, type errors, missing imports | Reports only TypeScript type errors and missing imports. |
| `generate_tests` | generate tests, write tests, test cases, unit tests | Outputs only test code with no surrounding explanation. |
| `log_analysis` | log, logs, error log, trace, debug | Returns only anomalies, errors, and notable patterns. |
| `replace_text` | replace, substitution, find and replace | Outputs only the modified text with replacements applied. |
| `summarize` | summarize, summary, tldr, brief | Returns 3–5 lines of dense summary in plain prose. |

### Custom patterns

Register your own patterns via `register_pattern`. The bridge uses the local model to refine your plain-language description into a precise system prompt:

```json
{
  "name": "security-audit",
  "description": "Audit code for security vulnerabilities, injection risks, and hardcoded secrets. Return findings grouped by severity."
}
```

Custom patterns persist across restarts if `BRIDGE_PATTERNS_FILE` is set.

---

## Capability map routing

The capability map routes prompts to different models based on keyword patterns. Set `BRIDGE_CAPABILITY_MAP` to a JSON object where keys are case-insensitive substring patterns and values are model names:

```bash
BRIDGE_CAPABILITY_MAP='{"code":"codellama:13b","log":"mistral:7b","review":"codellama:13b"}'
```

When `query_local_model` receives a prompt, it checks the prompt text against each pattern using case-insensitive substring matching. The first match wins. If no pattern matches, the default model is used.

Use **6. View Capability Map** in the console to inspect the current map and test a prompt against it interactively.

---

## Context window auto-detection

When you set a new default model via **3. Set Default Model** and skip the context window picker, the bridge queries Ollama's `/api/show` endpoint and reads the model's native context length from its architecture metadata. For example, setting a 32k model will automatically update `contextWindow` to `32768` without manual configuration.

You can also set the context window explicitly via **10. Edit Bridge Limits** or the `OLLAMA_CONTEXT_WINDOW` env var.

---

## Reduction log

Every `query_local_model` call appends a record to the reduction log (`BRIDGE_REDUCTION_LOG`). Each record captures the model used, input/output token counts, and the reduction ratio (output tokens / input tokens — lower means more compression).

View aggregate stats in the console with **7. View Reduction Stats**, or inspect the raw log:

```bash
# Windows PowerShell
Get-Content ollama-bridge-reductions.jsonl -Wait

# macOS / Linux
tail -f ollama-bridge-reductions.jsonl
```

---

## Development

```bash
# Run tests
npx vitest --run

# Build
npm run build

# Run the interactive console directly from source
npx tsx src/console/index.ts
```

See [TESTING.md](TESTING.md) for a full manual testing guide covering every tool, error scenarios, and tuning options.
