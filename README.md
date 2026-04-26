# Orchestrama

Connect your AI orchestrator to a local [Ollama](https://ollama.com) instance via the Model Context Protocol (MCP). Run LLMs locally without cloud dependencies, with full control over resource usage and model selection.

**Two interfaces, one bridge:**
- **MCP Server** — Exposes tools for AI orchestrators (Kiro, Claude Desktop, Cursor): query models, ping status, list/register intent patterns, get limits, setup configuration
- **Human Console** — Interactive CLI for operators to manage models, tune settings, run benchmarks, and monitor usage

---

## Quick Start

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org)
- **Ollama running** — `ollama serve` (or use [Ollama Desktop](https://ollama.com/download))
- **At least one model** — `ollama pull llama3.1:8b`

### Install & Build

```bash
git clone <repo-url>
cd orchestrama
npm install
npm run build
```

Verify the build:
```bash
ls dist/server.js
```

---

## MCP Server

The MCP server is what your AI orchestrator connects to. It exposes these tools:

| Tool | Purpose |
|---|---|
| `query_local_model` | Send a prompt (with optional context files and model options) to a local Ollama model |
| `ping_model` | Check whether a model is warm or cold and measure response time |
| `list_patterns` | List built-in and custom intent patterns for task-specific routing |
| `register_pattern` | Register a custom pattern for specialized system prompts |
| `get_bridge_limits` | Return enforced context limits and allowed directories |
| `run_command` | Run a bounded shell command and have the model interpret output |
| `rg_search` | Search with ripgrep and have the model interpret matches |
| `gh_command` | Run GitHub CLI commands and have the model interpret output |
| `get_content` | Read files/directories and have the model answer from their content |
| `git_command` | Run Git commands and have the model interpret output |
| `npm_command` | Run npm commands and have the model interpret output |
| `npx_command` | Run npx commands and have the model interpret output |
| `node_command` | Run Node.js commands and have the model interpret output |
| `pnpm_command`, `yarn_command` | Run alternative JavaScript package managers |
| `tsc_command`, `eslint_command`, `prettier_command` | Run TypeScript, lint, and format checks |
| `vitest_command`, `jest_command`, `playwright_command` | Run JavaScript and browser test tools |
| `python_command`, `pip_command`, `pytest_command`, `uv_command`, `poetry_command` | Run Python tooling |
| `docker_command`, `docker_compose_command`, `kubectl_command` | Run container and cluster tooling |
| `curl_command`, `jq_command`, `fd_command`, `ls_command`, `dir_command`, `powershell_command` | Run common shell and inspection tools |
| `task_command`, `make_command`, `just_command` | Run task runners and build recipes |
| `cargo_command`, `go_command`, `dotnet_command`, `mvn_command`, `gradle_command` | Run language-specific build tools |
| `ollama_command` | Run Ollama CLI commands |
| `declare_working_dirs` | Declare session-scoped working directories for dynamic access |
| `feedback` | Report MCP failures/inefficiencies and get a compact corrective rule |
| `setup_bridge` | Generate client-specific configuration snippet plus usage guide |

Command tools accept `prompt` plus `command`. Use `interpret: false` when the caller only needs raw exit code/output; this skips the model call and is preferred for builds, tests, status checks, and other validation commands. Use `max_output_chars` to cap output before interpretation.
Use MCP tools first and wait for their response; if a tool fails or lacks enough detail, call `feedback` before falling back to a real command.

### Wiring into Kiro

1. Open `.kiro/settings/mcp.json`
2. Add this server configuration:

```json
{
  "mcpServers": {
    "orchestrama": {
      "command": "node",
      "args": ["/absolute/path/to/dist/server.js"],
      "env": {
        "OLLAMA_DEFAULT_MODEL": "llama3.1:8b"
      }
    }
  }
}
```

3. Replace `/absolute/path/to` with your actual project path
4. Reload Kiro — the bridge appears in the MCP servers panel

### Wiring into Claude Desktop

1. Find your config file path:
   ```bash
   node dist/cli/generate_config.js --client claude-desktop
   ```
2. Open the path shown in the output
3. Add the server configuration from the snippet
4. Restart Claude Desktop

### Generate Config Snippets

Automatically generate configuration for any supported client:

```bash
# All clients
node dist/cli/generate_config.js

# Kiro only, with custom model and connectivity check
node dist/cli/generate_config.js --client kiro --env OLLAMA_DEFAULT_MODEL=mistral --test

# Claude Desktop only
node dist/cli/generate_config.js --client claude-desktop
```

### Smoke-test the Server

Verify the server works without a client:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/server.js
```

Expected: JSON response listing the MCP tools.

---

## Human Console

Launch the interactive console to manage models, tune settings, and run benchmarks:

```bash
npm run console
```

### Menu Options

```
Orchestrama Console
───────────────────
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
12. Run Benchmark Advisor
0. Exit
```

Press the number and Enter. Press `Ctrl+C` at any time to exit.

> **First startup:** If `OLLAMA_DEFAULT_MODEL` is not set, the Benchmark Advisor launches automatically before the menu appears.

### Menu Options Explained

**1. List Models**
Lists all models available in your local Ollama instance.

**2. Ping Model**
Prompts for a model name (leave blank for default). Reports warm/cold status and round-trip response time.

**3. Set Default Model**
Updates `OLLAMA_DEFAULT_MODEL` for the current session. Optionally auto-detects the model's context window from Ollama metadata. Changes take effect immediately.

**4. Run Benchmark**
Prompts for model selection, context window, iteration count, and warm-up preference. Runs latency, throughput, and response-length tests. Results can be saved to a JSON file via `BENCHMARK_OUTPUT_FILE`.

**5. View Configuration**
Displays all active configuration values: capability map, bridge limits, model fine-tuning options.

**6. View Capability Map**
Shows the full capability map. Optionally test a prompt to see which model would be selected.

**7. View Reduction Stats**
Reads the reduction log and displays aggregate statistics: total invocations, average reduction ratio, tokens saved, per-model and per-task breakdowns.

**8. Test Configuration**
Runs all health checks against your live Ollama instance: connectivity, model existence, end-to-end call, chunking, queue status. Each check shows ✅ / ❌ / ⏭️ with resolution hints.

**9. Test Configuration (dry run)**
Same as above but skips checks that make real Ollama calls. Useful for verifying config structure without needing Ollama running.

**10. Edit Bridge Limits**
Interactively update context limits for the current session:
- `maxContextFiles` — maximum number of context file paths per query
- `maxFileTokens` — maximum estimated tokens per individual file
- `maxTotalContextTokens` — maximum combined tokens across all files
- `contextWindow` — token limit before Map-Reduce chunking kicks in

All changes propagate immediately without restart.

**11. Edit Model Options**
Interactively set fine-tuning parameters applied to every Ollama call. Enter a number to set a value, press Enter to keep current, or type `clear` to reset. See [Model fine-tuning](#model-fine-tuning) for the full list.

**12. Run Benchmark Advisor**
Launches the Benchmark Advisor wizard. See [Benchmark Advisor](#benchmark-advisor) for details.

**0. Exit**
Exits cleanly with code 0.

---

## Configuration

Both the MCP server and console read the same environment variables. Copy `.env.example` to `.env` and adjust as needed.

### Core Settings

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_DEFAULT_MODEL` | `llama3.1:8b` | Model used when none is specified |
| `OLLAMA_CONTEXT_WINDOW` | `4096` | Token limit before Map-Reduce chunking |
| `OLLAMA_KEEP_ALIVE` | `10m` | How long Ollama keeps the model loaded |
| `OLLAMA_NUM_PARALLEL` | `1` | Number of concurrent Ollama requests |

### Bridge Behavior

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_ALLOWED_DIRS` | current working directory | Comma-separated directories the bridge may read from |
| `BRIDGE_CAPABILITY_MAP` | `{}` | JSON object mapping keyword patterns to model names |
| `BRIDGE_FALLBACK_MODELS` | _(none)_ | Comma-separated fallback models tried on resource exhaustion |
| `BRIDGE_QUEUE_MAX_SIZE` | `10` | Maximum queued requests before rejection |
| `BRIDGE_REQUEST_TIMEOUT_MS` | `300000` | Per-request timeout in milliseconds |
| `BRIDGE_SYSTEM_PROMPT` | _(built-in)_ | Override the system prompt injected into every query |
| `BRIDGE_REDUCTION_LOG` | `./orchestrama-reductions.jsonl` | Path to the token-reduction log file |
| `BRIDGE_LOG_LEVEL` | `info` | `info` or `debug` (debug logs payload previews) |
| `BRIDGE_DISABLE_PROGRESS` | `false` | Set to `true` to suppress MCP progress notifications |
| `BRIDGE_KEEPALIVE_ON_START` | `false` | Set to `true` to pre-warm the default model at startup |

### Context Limits

| Variable | Default | Description |
|---|---|---|
| `BRIDGE_MAX_CONTEXT_FILES` | `20` | Maximum number of context file paths per query |
| `BRIDGE_MAX_FILE_TOKENS` | `1024` | Maximum estimated tokens per individual file |
| `BRIDGE_MAX_TOTAL_CONTEXT_TOKENS` | `4096` | Maximum combined tokens across all files |

These can also be changed at runtime via **10. Edit Bridge Limits** in the console.

### Model Fine-Tuning

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

These are global defaults. Individual `query_local_model` calls can override them per-call using the `options` parameter. Call-level values take precedence.

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

## Benchmark Advisor

The Benchmark Advisor is a first-startup wizard that detects your hardware, filters installed models by memory budget, benchmarks candidates, and recommends the best model and context-window configuration for your machine.

### Launch

```bash
# Standalone
npx bridge-advisor

# Or from the console menu (option 12)
npm run console
```

On first startup — when `OLLAMA_DEFAULT_MODEL` is not set — the console launches the advisor automatically.

### What It Does

The wizard runs six phases:

1. **Hardware Detection** — Queries GPU VRAM (NVIDIA, AMD, macOS) and system RAM. Falls back to manual prompt if detection fails. Applies a configurable safety margin (default 10%) to compute usable VRAM budget.

2. **Memory Mode & Model Filtering** — Choose between:
   - *VRAM-only* — Only models that fit entirely in GPU VRAM (maximum throughput)
   - *RAM-assisted* — Larger models that exceed VRAM but fit in VRAM + system RAM (higher latency)

   Displays estimated VRAM footprint and inclusion/exclusion decision for every installed model.

3. **Context Window Safety Check** — For each candidate, tests all six standard context sizes (4K, 8K, 16K, 32K, 64K, 128K) and retains only those that fit alongside model weights in the VRAM budget. Models with no safe context window are excluded.

4. **Benchmark Execution** — Runs the standard task suite (code summarization, log analysis, file review) against each candidate at its maximum safe context window, with Flash Attention enabled and disabled.

5. **Recommendations** — Ranks results across four categories:

   | Category | Selection Criterion |
   |---|---|
   | Fastest | Highest mean throughput (tokens/s) |
   | Most Context | Largest safe context window |
   | FA | Greatest throughput improvement with Flash Attention |
   | ★ Best Overall | Weighted score: 50% throughput + 30% context + 20% FA |

   The report is appended to `ollama-benchmark.log`.

6. **Configuration Acceptance** — Pick a category (or enter a custom model/context). The selected model and context window are applied immediately. The advisor also derives MCP file-context limits from the chosen context window, so larger windows such as 64K or 128K allow proportionally larger `context_files` payloads. If Flash Attention is recommended, `OLLAMA_FLASH_ATTENTION=1` is set and you're reminded to persist it in your shell profile.

### Example report

```
Benchmark Advisor Report
========================
Generated: 2025-04-17T12:00:00.000Z

Hardware Summary
================
GPU:           NVIDIA RTX 4090
Total VRAM:    24,576 MB
Safety Margin: 10%
VRAM Budget:   22,118 MB
System RAM:    65,536 MB
Memory Mode:   VRAM-only

Category        | Model         | Params | Context Window | Throughput  | Latency  | VRAM        | FA  | Memory Mode
----------------|---------------|--------|----------------|-------------|----------|-------------|-----|------------
Fastest         | llama3.1:8b   | 8B     | 65,536         | 119.8 tok/s | 2526 ms  | 4,608 MB    | Yes | GPU-native 
Most Context    | gemma4:latest | 8B     | 131,072        | 114.3 tok/s | 11091 ms | 4,608 MB    | Yes | GPU-native 
FA              | llama3.1:8b   | 8B     | 65,536         | 119.8 tok/s | 2526 ms  | 4,608 MB    | Yes | GPU-native 
★ Best Overall  | llama3.1:8b   | 8B     | 65,536         | 119.8 tok/s | 2526 ms  | 4,608 MB    | Yes | GPU-native 
Most Parameters | gemma4:26b    | 25.8B  | 131,072        | 109.1 tok/s | 8665 ms  | 13,721.6 MB | Yes | GPU-native 
```

---

## Intent Patterns

The `query_local_model` tool accepts an `intent` parameter that selects a pre-configured system prompt optimized for a specific task. Built-in patterns are strictly output-scoped to minimize hallucination.

### Built-In Patterns

| Pattern | Keywords | Behavior |
|---|---|---|
| `code_review` | review, code review, refactor, lint | Returns only a bullet list of findings. No description of what the code does. |
| `explain_code` | explain, what does, how does, understand | Explains purpose and key behavior in ≤5 sentences. |
| `find_bugs` | bugs, defects, issues, problems | Lists only confirmed or likely bugs with location and reason. |
| `find_ts_errors` | typescript, ts errors, type errors, missing imports | Reports only TypeScript type errors and missing imports. |
| `generate_tests` | generate tests, write tests, test cases, unit tests | Outputs only test code with no surrounding explanation. |
| `log_analysis` | log, logs, error log, trace, debug | Returns only anomalies, errors, and notable patterns. |
| `replace_text` | replace, substitution, find and replace | Outputs only the modified text with replacements applied. |
| `summarize` | summarize, summary, tldr, brief | Returns 3–5 lines of dense summary in plain prose. |

### Custom Patterns

Register your own patterns via `register_pattern`. The bridge uses the local model to refine your plain-language description into a precise system prompt:

```json
{
  "name": "security-audit",
  "description": "Audit code for security vulnerabilities, injection risks, and hardcoded secrets. Return findings grouped by severity."
}
```

Custom patterns persist across restarts if `BRIDGE_PATTERNS_FILE` is set.

---

## Capability Map Routing

The capability map routes prompts to different models based on keyword patterns. Set `BRIDGE_CAPABILITY_MAP` to a JSON object where keys are case-insensitive substring patterns and values are model names:

```bash
BRIDGE_CAPABILITY_MAP='{"code":"codellama:13b","log":"mistral:7b","review":"codellama:13b"}'
```

When `query_local_model` receives a prompt, it checks the prompt text against each pattern using case-insensitive substring matching. The first match wins. If no pattern matches, the default model is used.

Use **6. View Capability Map** in the console to inspect the current map and test a prompt against it interactively.

---

## Context Window Auto-Detection

When you set a new default model via **3. Set Default Model** and skip the context window picker, the bridge queries Ollama's `/api/show` endpoint and reads the model's native context length from its architecture metadata. For example, setting a 32k model will automatically update `contextWindow` to `32768` without manual configuration.

You can also set the context window explicitly via **10. Edit Bridge Limits** or the `OLLAMA_CONTEXT_WINDOW` env var. When accepting a Benchmark Advisor recommendation, Orchestrama also writes matching `BRIDGE_MAX_CONTEXT_FILES`, `BRIDGE_MAX_FILE_TOKENS`, and `BRIDGE_MAX_TOTAL_CONTEXT_TOKENS` values so MCP file reads can use the larger window coherently.

---

## Reduction Log

Every `query_local_model` call appends a record to the reduction log (`BRIDGE_REDUCTION_LOG`). Each record captures the model used, input/output token counts, and the reduction ratio (output tokens / input tokens — lower means more compression).

View aggregate stats in the console with **7. View Reduction Stats**, or inspect the raw log:

```bash
# Windows PowerShell
Get-Content orchestrama-reductions.jsonl -Wait

# macOS / Linux
tail -f orchestrama-reductions.jsonl
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


---

## License

MIT

---

## Support

For issues, questions, or contributions, please open an issue on the repository.

**Ready to launch.** ✅
