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
ollama pull llama3
```

---

## 1. Build the bridge

```bash
npm install
npm run build
```

Verify the output exists:
```bash
# Should print the server path
ls dist/server.js
ls dist/cli/generate_config.js
```

---

## 2. Smoke-test the server directly (no MCP client needed)

The server speaks JSON-RPC over stdio. You can drive it manually with a heredoc to confirm it starts and responds.

```bash
# Start the server in one terminal, pipe a ListTools request
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/server.js
```

Expected: the server logs `ollama-mcp-bridge started...` to stderr and writes a JSON response to stdout listing all 7 tools.

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

The `--test` flag will attempt to reach Ollama and report ✅/❌ for each check. This is the fastest way to confirm the bridge can talk to Ollama before wiring it into a client.

---

## 4. Wire into Kiro (or another MCP client)

### Kiro

Open `.kiro/settings/mcp.json` (create it if it doesn't exist) and paste the snippet from step 3:

```json
{
  "mcpServers": {
    "ollama-mcp-bridge": {
      "command": "node",
      "args": ["C:/path/to/your/project/dist/server.js"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "OLLAMA_DEFAULT_MODEL": "llama3"
      }
    }
  }
}
```

Replace the `args` path with the absolute path printed by `generate-config`. Reload Kiro — the bridge should appear in the MCP servers panel.

### Claude Desktop

Paste the snippet into `claude_desktop_config.json` at the path shown by `generate-config --client claude-desktop`. Restart Claude Desktop.

### MCP Inspector (no client install needed)

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a standalone tool for testing MCP servers interactively:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

This opens a browser UI where you can call any tool by hand — the easiest way to test without configuring a full client.

---

## 5. Test each tool manually

Once the bridge is connected, run these in your MCP client's tool panel or via the Inspector.

### `test_config` — start here

This is the built-in health check. Run it first.

```json
{}
```

Expected output:
```
✅ Ollama connectivity [12ms]
✅ Default model existence [45ms]
✅ End-to-end call [1203ms]
✅ Chunking mechanism [2100ms]
✅ Queue status
```

If any check shows ❌, the message includes a resolution suggestion.

Dry run (no real Ollama calls):
```json
{ "dry_run": true }
```

---

### `list_local_models`

```json
{}
```

Expected: a newline-separated list of your installed models, e.g.:
```
llama3:latest
mistral:7b
codellama:13b
```

---

### `ping_model`

```json
{ "model": "llama3" }
```

Expected:
```
Model: llama3
Status: warm start
Response time: 45ms
```

First call after a cold start will say `cold start` and take longer. Subsequent calls within the keep-alive window say `warm start`.

Omit `model` to ping the default:
```json
{}
```

---

### `query_local_model` — basic prompt

```json
{
  "prompt": "What is 2 + 2? Reply with just the number."
}
```

Expected: `4` (or similar terse response — the built-in system prompt suppresses filler).

---

### `query_local_model` — with context files

Point it at a real file in your project:

```json
{
  "prompt": "Summarize what this file does in 2 sentences.",
  "context_files": ["src/chunking/index.ts"]
}
```

Expected: a 2-sentence summary of the chunker module. Check stderr for the log line:
```
[ollama-mcp-bridge] query_local_model | model=llama3 | files=1 | tokens=NNN
```

Try a directory:
```json
{
  "prompt": "List any security concerns you see in this codebase.",
  "context_files": ["src/files"]
}
```

---

### `query_local_model` — force chunking

Create a large payload to trigger Map-Reduce. The context window defaults to 4096 tokens (~16 KB of text). Pass a file larger than that:

```json
{
  "prompt": "Summarize the key points.",
  "context_files": ["package-lock.json"]
}
```

`package-lock.json` is typically large enough to trigger chunking. Watch stderr for:
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
  "OLLAMA_DEFAULT_MODEL": "llama3",
  "BRIDGE_CAPABILITY_MAP": "{\"review\":\"codellama\",\"log\":\"mistral\"}"
}
```

Then call:
```json
{
  "prompt": "Please review this function for bugs."
}
```

Check stderr — it should log:
```
[ollama-mcp-bridge] Capability map match: pattern="review" → model="codellama"
```

---

### `get_capability_map`

Inspect the current routing table and test a prompt against it:

```json
{ "prompt": "analyze these logs for errors" }
```

Expected:
```
Capability map:
  "review" → codellama
  "log" → mistral

Resolved model for prompt: mistral
```

---

### `get_reduction_stats`

After a few `query_local_model` calls:

```json
{}
```

Expected:
```
Total invocations: 4
Average reduction ratio: 0.142
Total tokens saved: 3820

By model:
  llama3: 3 invocations, avg ratio 0.155
  codellama: 1 invocations, avg ratio 0.089

By task type:
  generic: 2 invocations, avg ratio 0.160
  code_review: 1 invocations, avg ratio 0.089
  summarization: 1 invocations, avg ratio 0.120
```

The reduction log is written to `./ollama-bridge-reductions.jsonl`. You can inspect it directly:
```bash
cat ollama-bridge-reductions.jsonl
```

---

### `benchmark_models`

Run against specific models:

```json
{
  "models": ["llama3"],
  "iterations": 3
}
```

Expected: a table with latency (ms), throughput (tokens/s), and response length for each of the 3 built-in tasks (code summarization, log analysis, file review), with mean ± std dev across 3 iterations.

Omit `models` to benchmark everything installed:
```json
{ "iterations": 1 }
```

---

## 6. Test error handling

### Ollama not running

Stop Ollama, then call any tool. Expected error:
```
Ollama not available at http://localhost:11434
```

### Model not found

```json
{
  "prompt": "hello",
  "model": "this-model-does-not-exist"
}
```

Expected error: `Model 'this-model-does-not-exist' not found in Ollama`

### Path outside allowed directories

```json
{
  "prompt": "summarize this",
  "context_files": ["C:/Windows/System32/drivers/etc/hosts"]
}
```

Expected: the payload contains `[SECURITY ERROR: path outside allowed directories]` and the prompt is still processed (the file is skipped, not the whole request).

### Invalid parameters

```json
{
  "prompt": 12345
}
```

Expected MCP error with code `invalid_params`.

---

## 7. Environment variable tuning

Edit the env block in your MCP config to try different settings without rebuilding:

```json
"env": {
  "OLLAMA_DEFAULT_MODEL": "mistral",
  "OLLAMA_CONTEXT_WINDOW": "2048",
  "OLLAMA_KEEP_ALIVE": "30m",
  "BRIDGE_LOG_LEVEL": "debug",
  "BRIDGE_KEEPALIVE_ON_START": "true",
  "BRIDGE_FALLBACK_MODELS": "llama3:8b,tinyllama",
  "BRIDGE_CAPABILITY_MAP": "{\"code\":\"codellama\",\"log\":\"mistral\"}"
}
```

`BRIDGE_LOG_LEVEL=debug` is especially useful — it includes the first 200 chars of every payload and response in both stderr and the reduction log.

`BRIDGE_KEEPALIVE_ON_START=true` pre-warms the model when the bridge starts, so the first real request doesn't pay cold-start latency.

---

## 8. Watch the reduction log in real time

```bash
# Windows PowerShell
Get-Content ollama-bridge-reductions.jsonl -Wait

# macOS / Linux
tail -f ollama-bridge-reductions.jsonl
```

Each line is a JSON object. After several calls you'll see the reduction ratio trend — a ratio of 0.1 means the local model compressed 10× (returned 10% of the input tokens), which is the whole point of the bridge.

---

## Quick reference

| Tool | What to verify |
|---|---|
| `test_config` | All 5 checks ✅ |
| `list_local_models` | Your installed models appear |
| `ping_model` | Warm/cold status + response time |
| `query_local_model` | Response matches prompt intent; stderr log shows model/files/tokens |
| `query_local_model` + large file | Chunking log lines appear in stderr |
| `get_capability_map` | Routing resolves to the right model |
| `get_reduction_stats` | Invocation count grows after each query |
| `benchmark_models` | Table with latency/throughput per model |
