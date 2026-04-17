# Manual Testing Guide — ollama-mcp-bridge

This guide walks through testing the bridge the way a real user would: building it, wiring it into an MCP client, and exercising each tool by hand. No mocks, no test runner — just you, Ollama, and an MCP client.

---

## Prerequisites

| Requirement | Check |
|---|---|
| Node.js 18+ | `node --version` |
| Ollama running | `curl http://localhost:11434/api/tags` |
| At least one model pulled | `ollama list` |
| An MCP client (Kiro, Claude Desktop, or the MCP Inspector) | see below |

Pull a model if you don't have one:
```bash
ollama pull llama3.1:8b
```

---

## 1. Build the bridge

```bash
npm install
npm run build
```

Verify the output exists:
```bash
ls dist/server.js
ls dist/cli/generate_config.js
```

---

## 2. Smoke-test the server directly (no MCP client needed)

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/server.js
```

Expected: the server logs `ollama-mcp-bridge started...` to stderr and writes a JSON response to stdout listing all 6 tools.

---

## 3. Generate your MCP config snippet

```bash
# See snippets for all clients
node dist/cli/generate_config.js

# Just for Kiro
node dist/cli/generate_config.js --client kiro

# Override the default model in the snippet
node dist/cli/generate_config.js --client kiro --env OLLAMA_DEFAULT_MODEL=mistral

# Generate snippet AND run a live connectivity check
node dist/cli/generate_config.js --client kiro --test
```

Or use the `setup_bridge` MCP tool directly — it generates the config snippet and a full usage guide in one call, and can run health checks when `run_checks: true` is passed.

---

## 4. Wire into an MCP client

### Kiro

Open `.kiro/settings/mcp.json` and paste the snippet from step 3:

```json
{
  "mcpServers": {
    "ollama-mcp-bridge": {
      "command": "node",
      "args": ["C:/path/to/your/project/dist/server.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "OLLAMA_DEFAULT_MODEL": "llama3.1:8b"
      }
    }
  }
}
```

Replace the `args` path with the absolute path printed by `generate_config`. Reload Kiro — the bridge should appear in the MCP servers panel.

### Claude Desktop

Paste the snippet into `claude_desktop_config.json` at the path shown by `generate_config --client claude-desktop`. Restart Claude Desktop.

### MCP Inspector (no client install needed)

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

This opens a browser UI where you can call any tool by hand — the easiest way to test without configuring a full client.

---

## 5. Test each MCP tool

Once the bridge is connected, run these in your MCP client's tool panel or via the Inspector.

### `setup_bridge` — start here

Generates the config snippet and a full usage guide. Run this first to confirm the bridge is reachable and to get a quick orientation.

```json
{ "client": "kiro", "run_checks": true }
```

Expected: config JSON, tool descriptions, pattern list, and health check results (✅/❌ for Ollama connectivity and default model existence).

---

### `get_bridge_limits`

Returns the current enforced limits. Call this before sending `context_files` to avoid rejections.

```json
{}
```

Expected output (values reflect current config):
```
Bridge limits

{
  "context_window": 32768,
  "max_context_files": 20,
  "max_file_tokens": 4096,
  "max_total_context_tokens": 32768,
  "allowed_dirs": ["/your/project"]
}
```

Note: `context_window` reflects the live config value. If you set a 32k model via the console and the auto-detection ran, this will show `32768` rather than the default `4096`.

---

### `ping_model`

```json
{ "model": "llama3.1:8b" }
```

Expected:
```
Model: llama3.1:8b
Status: cold start
Response time: 18432ms
```

Subsequent calls within the keep-alive window will show `warm start` and much lower response times. Omit `model` to ping the default.

---

### `list_patterns`

```json
{}
```

Expected: all 8 built-in patterns with names, descriptions, and keywords. Use the `filter` parameter to narrow results:

```json
{ "filter": "bug" }
```

---

### `register_pattern`

```json
{
  "name": "security-audit",
  "description": "Audit code for security vulnerabilities, injection risks, and hardcoded secrets. Return findings grouped by severity."
}
```

Expected: the bridge uses the local model to refine your description into a precise system prompt, then confirms registration. The pattern is immediately available as an `intent` value.

---

### `query_local_model` — basic prompt

```json
{
  "prompt": "What is 2 + 2? Reply with just the number."
}
```

Expected: `4` — the built-in system prompt suppresses filler and preamble.

---

### `query_local_model` — with intent pattern

```json
{
  "prompt": "Find any bugs in this function.",
  "context_files": ["src/queue/request_queue.ts"],
  "intent": "find_bugs"
}
```

Expected: a concise bullet list of confirmed or likely bugs only. No preamble, no style suggestions, no speculation. If no bugs are found: `No bugs found.`

Try other patterns:
```json
{ "prompt": "Review this file.", "context_files": ["src/config.ts"], "intent": "code_review" }
{ "prompt": "Summarize this.", "context_files": ["README.md"], "intent": "summarize" }
{ "prompt": "Explain this.", "context_files": ["src/chunking/index.ts"], "intent": "explain_code" }
```

---

### `query_local_model` — with model fine-tuning options

Override temperature and seed for a single call:

```json
{
  "prompt": "Write a one-sentence description of this file.",
  "context_files": ["src/config.ts"],
  "options": {
    "temperature": 0.1,
    "seed": 42
  }
}
```

Run the same call twice — with `seed: 42` and `temperature: 0.1` the output should be identical both times. Remove `seed` and raise `temperature` to `1.5` to see more varied output.

Available `options` fields:

| Field | Range | Effect |
|---|---|---|
| `temperature` | 0.0–2.0 | Lower = more deterministic |
| `top_p` | 0.0–1.0 | Nucleus sampling threshold |
| `top_k` | integer | Top-k sampling (`0` = disabled) |
| `repeat_penalty` | float | Penalty for repeated tokens (`1.0` = none) |
| `seed` | integer | Fixed seed for reproducibility (`-1` = random) |
| `num_predict` | integer | Max tokens to generate (`-1` = model default) |
| `min_p` | 0.0–1.0 | Minimum token probability |
| `tfs_z` | float | Tail-free sampling |

Call-level `options` override any global defaults set via `OLLAMA_MODEL_OPTIONS` or the console.

---

### `query_local_model` — with context files

```json
{
  "prompt": "Summarize what this file does in 2 sentences.",
  "context_files": ["src/chunking/index.ts"]
}
```

Check stderr for the log line:
```
[ollama-mcp-bridge] query_local_model | model=llama3.1:8b | files=1 | tokens=NNN
```

**File too large error:** if a file exceeds `max_file_tokens`, you'll get:
```
Context file too large: "src/ollama/client.ts" estimated at 1775 tokens (limit 1024)
```

Fix this by raising the limit via **10. Edit Bridge Limits** in the console, or set `BRIDGE_MAX_FILE_TOKENS` to a higher value (e.g. `4096`).

---

### `query_local_model` — force chunking

Pass a file large enough to exceed the context window to trigger Map-Reduce chunking:

```json
{
  "prompt": "Summarize the key points.",
  "context_files": ["package-lock.json"]
}
```

Watch stderr for chunk progress:
```
[ollama-mcp-bridge] Processing chunk 1/3
[ollama-mcp-bridge] Processing chunk 2/3
...
```

---

### `query_local_model` — capability map routing

Set `BRIDGE_CAPABILITY_MAP` in your MCP config env:

```json
"env": {
  "OLLAMA_DEFAULT_MODEL": "llama3.1:8b",
  "BRIDGE_CAPABILITY_MAP": "{\"review\":\"codellama\",\"log\":\"mistral\"}"
}
```

Then call:
```json
{ "prompt": "Please review this function for bugs." }
```

Check stderr — it should log the capability map match and the resolved model.

---

## 6. Test the Human Console

Launch the console:

```bash
npm run console
```

### Option 3 — Set Default Model with auto-detection

1. Select `3` and enter a model name that has a large context window (e.g. `qwen2.5:32b`).
2. When prompted for a context window, press Enter to skip.
3. The console should print: `Context window auto-detected from model: 32768` (or whatever the model reports).
4. Select `5` (View Configuration) and confirm `contextWindow` shows the detected value.
5. Call `get_bridge_limits` from your MCP client — it should now report the updated value.

### Option 10 — Edit Bridge Limits

1. Select `10`.
2. Change `maxFileTokens` from `1024` to `4096`.
3. Select `5` to confirm the change is reflected in the config.
4. Call `get_bridge_limits` from your MCP client — it should now report `max_file_tokens: 4096`.
5. Retry a previously-failing large file — it should now be accepted.

### Option 11 — Edit Model Options

1. Select `11`.
2. Set `temperature` to `0.1` and `seed` to `42`.
3. Select `5` to confirm the options appear in the config display.
4. Call `query_local_model` from your MCP client — the model should now use those parameters globally.
5. Call `query_local_model` with `"options": {"temperature": 1.5}` — the per-call value should override the global default.
6. Return to option `11`, type `clear` for `temperature` and `seed` to reset them.

---

## 7. Test error handling

### Ollama not running

Stop Ollama, then call any tool. Expected error:
```
Ollama not available at http://localhost:11434
```

### Model not found

```json
{ "prompt": "hello", "model": "this-model-does-not-exist" }
```

Expected: `Model 'this-model-does-not-exist' not found in Ollama`

### File too large

```json
{ "prompt": "summarize", "context_files": ["src/ollama/client.ts"] }
```

With default `BRIDGE_MAX_FILE_TOKENS=1024`, expected:
```
Context file too large: "src/ollama/client.ts" estimated at 1775 tokens (limit 1024)
```

Raise the limit via the console (option 10) or env var and retry.

### Path outside allowed directories

```json
{
  "prompt": "summarize this",
  "context_files": ["C:/Windows/System32/drivers/etc/hosts"]
}
```

Expected: the payload contains `[SECURITY ERROR: path outside allowed directories]` and the prompt is still processed (the file is skipped, not the whole request).

### Invalid `options` field type

```json
{ "prompt": "hello", "options": { "temperature": "hot" } }
```

Expected MCP error: `"options.temperature" must be a number, got string`

### Invalid parameters

```json
{ "prompt": 12345 }
```

Expected MCP error with code `invalid_params`.

---

## 8. Environment variable tuning

Edit the env block in your MCP config to try different settings without rebuilding:

```json
"env": {
  "OLLAMA_DEFAULT_MODEL": "qwen2.5:32b",
  "OLLAMA_CONTEXT_WINDOW": "32768",
  "OLLAMA_KEEP_ALIVE": "30m",
  "OLLAMA_MODEL_OPTIONS": "{\"temperature\":0.2,\"seed\":42}",
  "BRIDGE_MAX_FILE_TOKENS": "4096",
  "BRIDGE_MAX_TOTAL_CONTEXT_TOKENS": "32768",
  "BRIDGE_LOG_LEVEL": "debug",
  "BRIDGE_KEEPALIVE_ON_START": "true",
  "BRIDGE_FALLBACK_MODELS": "llama3.1:8b,tinyllama",
  "BRIDGE_CAPABILITY_MAP": "{\"code\":\"codellama\",\"log\":\"mistral\"}"
}
```

`BRIDGE_LOG_LEVEL=debug` includes the first 200 chars of every payload and response in both stderr and the reduction log.

`BRIDGE_KEEPALIVE_ON_START=true` pre-warms the model when the bridge starts, so the first real request doesn't pay cold-start latency.

`OLLAMA_MODEL_OPTIONS` sets global generation defaults. Individual calls can override these with the `options` parameter.

---

## 9. Watch the reduction log in real time

```bash
# Windows PowerShell
Get-Content ollama-bridge-reductions.jsonl -Wait

# macOS / Linux
tail -f ollama-bridge-reductions.jsonl
```

Each line is a JSON object. A `reductionRatio` of `0.1` means the model returned 10% of the input tokens — the whole point of the bridge.

---

## Quick reference

| Tool / Option | What to verify |
|---|---|
| `setup_bridge` | Config snippet generated; health checks pass |
| `get_bridge_limits` | Reflects live config (not stale startup values) |
| `ping_model` | Warm/cold status + response time |
| `list_patterns` | All 8 built-in patterns listed; custom patterns appear after `register_pattern` |
| `query_local_model` | Response matches prompt intent; stderr log shows model/files/tokens |
| `query_local_model` + `intent` | Concise, on-format output; no preamble or hallucinated extras |
| `query_local_model` + `options` | Per-call temperature/seed override works; call-level beats config-level |
| `query_local_model` + large file | Chunking log lines appear in stderr |
| Console option 3 | Context window auto-detected from model metadata |
| Console option 10 | `max_file_tokens` change reflected in `get_bridge_limits` immediately |
| Console option 11 | Global model options applied; per-call `options` still overrides |
| Reduction log | Invocation count grows; `reductionRatio` < 1.0 |
