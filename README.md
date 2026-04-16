# ollama-mcp-bridge

A bridge that connects AI orchestrators (Kiro, Claude Desktop, Cursor) to a local [Ollama](https://ollama.com) instance via the Model Context Protocol (MCP). It exposes two interfaces with distinct audiences:

- **MCP Server** — the stdio-based MCP process consumed by AI orchestrators. Exposes only `query_local_model` and `ping_model`.
- **Human Console** — an interactive CLI for the operator to manage models, run benchmarks, inspect configuration, and view statistics.

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

The MCP server is what your AI orchestrator connects to. It exposes two tools:

| Tool | Description |
|---|---|
| `query_local_model` | Send a prompt (with optional context files) to a local Ollama model |
| `ping_model` | Check whether a model is warm or cold and measure response time |

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

Expected: a JSON response listing `query_local_model` and `ping_model`.

---

## Human Console

The Human Console is an interactive terminal UI for the operator. It provides access to all administrative functions that are intentionally kept out of the MCP server.

### Launch

```bash
# Via npm script
npm run console

# Via the installed binary (after npm install -g or npm link)
bridge-console

# Directly
node dist/console/index.js
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
0. Exit
```

Type the number and press Enter. Press `Ctrl+C` at any time to exit.

### Menu options

**1. List Models**
Lists all models currently available in your local Ollama instance.

**2. Ping Model**
Prompts for a model name (leave blank to use the default). Reports warm/cold status and round-trip response time in ms. A warm model is already loaded in memory; a cold model has to be loaded from disk first.

**3. Set Default Model**
Updates `OLLAMA_DEFAULT_MODEL` for the current session. Does not persist to disk — restart the console or set the env var to make it permanent.

**4. Run Benchmark**
Prompts for an optional comma-separated list of model names (leave blank to benchmark all installed models) and an optional iteration count (default: 1). Runs latency, throughput, and response-length tests and prints a formatted report. If `BENCHMARK_OUTPUT_FILE` is set, the JSON report is also saved to that path.

**5. View Configuration**
Displays all active configuration values loaded from environment variables, including the capability map formatted as `pattern → model` pairs.

**6. View Capability Map**
Shows the full capability map. Optionally enter a test prompt to see which model would be selected for it.

**7. View Reduction Stats**
Reads the reduction log and displays aggregate statistics: total invocations, average reduction ratio, total tokens saved, and per-model / per-task-type breakdowns. If no log exists yet, reports that no stats are available.

**8. Test Configuration**
Runs all five health checks against your live Ollama instance:
- Ollama connectivity
- Default model existence
- End-to-end call
- Chunking mechanism
- Queue status

Each check shows ✅ / ❌ / ⏭️ with a resolution hint on failure.

**9. Test Configuration (dry run)**
Same as above but skips checks that make real Ollama calls. Useful for verifying config structure without needing Ollama to be running.

**0. Exit**
Exits cleanly with code 0.

---

## Configuration

Both the MCP server and the Human Console read the same environment variables.

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_DEFAULT_MODEL` | `llama3.1:8b` | Model used when none is specified |
| `OLLAMA_CONTEXT_WINDOW` | `4096` | Token limit before Map-Reduce chunking kicks in |
| `OLLAMA_KEEP_ALIVE` | `10m` | How long Ollama keeps the model loaded after a request |
| `OLLAMA_NUM_PARALLEL` | `1` | Number of concurrent Ollama requests |
| `BRIDGE_ALLOWED_DIRS` | current working directory | Comma-separated list of directories the bridge may read files from |
| `BRIDGE_CAPABILITY_MAP` | `{}` | JSON object mapping keyword patterns to model names, e.g. `{"code":"codellama","log":"mistral"}` |
| `BRIDGE_FALLBACK_MODELS` | _(none)_ | Comma-separated fallback models if the primary is unavailable |
| `BRIDGE_QUEUE_MAX_SIZE` | `10` | Maximum number of queued requests before new ones are rejected |
| `BRIDGE_REQUEST_TIMEOUT_MS` | `300000` | Per-request timeout in milliseconds |
| `BRIDGE_REDUCTION_LOG` | `./ollama-bridge-reductions.jsonl` | Path to the token-reduction log file |
| `BRIDGE_LOG_LEVEL` | `info` | `info` or `debug` (debug logs payload previews) |
| `BRIDGE_DISABLE_PROGRESS` | `false` | Set to `true` to suppress MCP progress notifications |
| `BRIDGE_KEEPALIVE_ON_START` | `false` | Set to `true` to pre-warm the default model when the server starts |
| `BRIDGE_SYSTEM_PROMPT` | _(built-in)_ | Override the system prompt injected into every query |
| `BENCHMARK_OUTPUT_FILE` | _(none)_ | If set, benchmark results are saved as JSON to this path |

### Example `.env`

```bash
OLLAMA_DEFAULT_MODEL=llama3.1:8b
OLLAMA_CONTEXT_WINDOW=8192
OLLAMA_KEEP_ALIVE=30m
BRIDGE_CAPABILITY_MAP={"code":"codellama:13b","log":"mistral:7b"}
BRIDGE_LOG_LEVEL=debug
BRIDGE_KEEPALIVE_ON_START=true
BENCHMARK_OUTPUT_FILE=./benchmark-results.json
```

---

## Capability Map routing

The capability map lets you route prompts to different models based on keyword patterns. Set `BRIDGE_CAPABILITY_MAP` to a JSON object where keys are regex-compatible patterns and values are model names:

```bash
BRIDGE_CAPABILITY_MAP='{"code":"codellama:13b","log":"mistral:7b","review":"codellama:13b"}'
```

When `query_local_model` receives a prompt, it checks the prompt text against each pattern in order. The first match wins. If no pattern matches, the default model is used.

Use **6. View Capability Map** in the Human Console to inspect the current map and test a prompt against it interactively.

---

## Reduction log

Every `query_local_model` call appends a record to the reduction log (`BRIDGE_REDUCTION_LOG`). Each record captures the model used, input/output token counts, and the reduction ratio (how much the local model compressed the response relative to the input).

View aggregate stats in the Human Console with **7. View Reduction Stats**, or inspect the raw log:

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
npm test

# Build
npm run build

# Run the interactive console directly from source (requires ts-node or tsx)
npx tsx src/console/index.ts
```

See [TESTING.md](TESTING.md) for a full manual testing guide covering every tool, error scenarios, and environment variable tuning.
