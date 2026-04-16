#!/usr/bin/env node
/**
 * ollama-mcp-bridge interactive setup console
 *
 * Runs in one shot:
 *   1. Checks prerequisites (Node version, Ollama reachability)
 *   2. Discovers available models and lets you pick a default
 *   3. Detects installed MCP clients on this machine
 *   4. Writes the config for every detected client
 *   5. Runs test_config to verify the full stack
 *   6. Prints a ready-to-paste system prompt for the orchestrator
 */

import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import os from "os";
import { createInterface } from "readline";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CLI flags ───────────────────────────────────────────────────────────────

const { values: _flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    yes:   { type: "boolean", short: "y", default: false },
    url:   { type: "string",  default: "" },
    model: { type: "string",  default: "" },
  },
  allowPositionals: false,
  strict: false,
});

const flags = {
  yes:   _flags.yes   === true,
  url:   typeof _flags.url   === "string" ? _flags.url   : "",
  model: typeof _flags.model === "string" ? _flags.model : "",
};

// ─── helpers ────────────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const BLUE   = "\x1b[34m";

function ok(msg: string)   { console.log(`  ${GREEN}✔${RESET}  ${msg}`); }
function warn(msg: string) { console.log(`  ${YELLOW}⚠${RESET}  ${msg}`); }
function fail(msg: string) { console.log(`  ${RED}✘${RESET}  ${msg}`); }
function info(msg: string) { console.log(`  ${CYAN}→${RESET}  ${msg}`); }
function step(msg: string) { console.log(`\n${BOLD}${BLUE}▶ ${msg}${RESET}`); }
function hr()              { console.log(`\n${DIM}${"─".repeat(60)}${RESET}`); }

function ask(question: string, defaultVal = ""): Promise<string> {
  if (flags.yes) {
    console.log(`  ${CYAN}?${RESET}  ${question} ${DIM}(auto: ${defaultVal || "default"})${RESET}`);
    return Promise.resolve(defaultVal);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${CYAN}?${RESET}  ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

// ─── constants ───────────────────────────────────────────────────────────────

const SERVER_PATH = path.resolve(__dirname, "../../dist/server.js");
const HOME        = os.homedir();
const PLATFORM    = process.platform;
const APPDATA     = process.env["APPDATA"] ?? path.join(HOME, "AppData", "Roaming");

// ─── step 1: prerequisites ───────────────────────────────────────────────────

async function checkPrerequisites(ollamaUrl: string): Promise<boolean> {
  step("Checking prerequisites");

  // Node version
  const [major] = process.versions.node.split(".").map(Number);
  if (major >= 18) {
    ok(`Node.js ${process.versions.node}`);
  } else {
    fail(`Node.js ${process.versions.node} — need 18+`);
    return false;
  }

  // dist/server.js exists
  if (await fileExists(SERVER_PATH)) {
    ok(`Bridge built at ${SERVER_PATH}`);
  } else {
    fail(`dist/server.js not found — run ${BOLD}npm run build${RESET} first`);
    return false;
  }

  // Ollama reachable
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (res.ok) {
      ok(`Ollama reachable at ${ollamaUrl}`);
      return true;
    } else {
      fail(`Ollama returned HTTP ${res.status} at ${ollamaUrl}`);
      return false;
    }
  } catch {
    fail(`Cannot reach Ollama at ${ollamaUrl} — is it running?`);
    return false;
  }
}

// ─── step 2: model selection ─────────────────────────────────────────────────

async function pickModel(ollamaUrl: string): Promise<string> {
  step("Selecting default model");

  let models: string[] = [];
  try {
    const res  = await fetch(`${ollamaUrl}/api/tags`);
    const data = await res.json() as { models: Array<{ name: string }> };
    models = data.models.map((m) => m.name);
  } catch {
    warn("Could not fetch model list — using llama3.1:8b as default");
    return "llama3.1:8b";
  }

  if (models.length === 0) {
    warn("No models found in Ollama — using llama3.1:8b as default");
    return "llama3.1:8b";
  }

  console.log(`\n  Available models:`);
  models.forEach((m, i) => console.log(`    ${DIM}[${i + 1}]${RESET} ${m}`));

  // Auto-pick: prefer llama3.1:8b, then first model
  const preferred = models.find((m) => m.startsWith("llama3.1:8b")) ?? models[0];

  // --model flag overrides interactive selection
  if (flags.model) {
    const forced = models.find((m) => m === flags.model) ?? flags.model;
    ok(`Using ${forced} (--model flag)`);
    return forced;
  }

  const answer = await ask(`Pick a model [1-${models.length}] or press Enter for ${BOLD}${preferred}${RESET}:`, "");

  if (answer === "") {
    ok(`Using ${preferred}`);
    return preferred;
  }

  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < models.length) {
    ok(`Using ${models[idx]}`);
    return models[idx];
  }

  warn(`Invalid choice — using ${preferred}`);
  return preferred;
}

// ─── step 3: detect clients ───────────────────────────────────────────────────

interface ClientDef {
  name: string;
  label: string;
  configPath: string;
  format: "json" | "toml";
  mergeKey: string;          // key inside the config object that holds servers
}

function getClients(): ClientDef[] {
  return [
    {
      name: "kiro",
      label: "Kiro",
      configPath: path.join(HOME, ".kiro", "settings", "mcp.json"),
      format: "json",
      mergeKey: "mcpServers",
    },
    {
      name: "claude-desktop",
      label: "Claude Desktop",
      configPath: PLATFORM === "win32"
        ? path.join(APPDATA, "Claude", "claude_desktop_config.json")
        : PLATFORM === "darwin"
          ? path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
          : path.join(HOME, ".config", "claude", "claude_desktop_config.json"),
      format: "json",
      mergeKey: "mcpServers",
    },
    {
      name: "claude-code",
      label: "Claude Code",
      configPath: path.join(HOME, ".claude.json"),
      format: "json",
      mergeKey: "mcpServers",
    },
    {
      name: "cursor",
      label: "Cursor",
      configPath: PLATFORM === "win32"
        ? path.join(APPDATA, "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json")
        : PLATFORM === "darwin"
          ? path.join(HOME, "Library", "Application Support", "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json")
          : path.join(HOME, ".config", "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json"),
      format: "json",
      mergeKey: "mcpServers",
    },
    {
      name: "codex",
      label: "Codex CLI / Desktop / VS Code",
      configPath: path.join(HOME, ".codex", "config.toml"),
      format: "toml",
      mergeKey: "mcp_servers",
    },
  ];
}

async function detectClients(clients: ClientDef[]): Promise<ClientDef[]> {
  step("Detecting installed MCP clients");

  const detected: ClientDef[] = [];
  for (const client of clients) {
    const dir = path.dirname(client.configPath);
    const dirExists = await fileExists(dir);
    const fileAlreadyExists = await fileExists(client.configPath);

    if (dirExists || fileAlreadyExists) {
      ok(`${client.label} — ${DIM}${client.configPath}${RESET}`);
      detected.push(client);
    } else {
      info(`${client.label} — not detected (${DIM}${dir}${RESET} missing)`);
    }
  }

  if (detected.length === 0) {
    warn("No clients detected — will write a generic JSON snippet instead");
  }

  return detected;
}

// ─── step 4: write configs ────────────────────────────────────────────────────

function buildServerEntry(model: string, ollamaUrl: string) {
  return {
    command: "node",
    args: [SERVER_PATH],
    env: {
      OLLAMA_BASE_URL: ollamaUrl,
      OLLAMA_DEFAULT_MODEL: model,
      OLLAMA_CONTEXT_WINDOW: "4096",
      OLLAMA_KEEP_ALIVE: "10m",
      BRIDGE_ALLOWED_DIRS: process.cwd(),
    },
    disabled: false,
    autoApprove: [] as string[],
  };
}

async function writeJsonConfig(client: ClientDef, model: string, ollamaUrl: string) {
  await ensureDir(path.dirname(client.configPath));

  let existing: Record<string, unknown> = {};
  if (await fileExists(client.configPath)) {
    try {
      const raw = await fs.readFile(client.configPath, "utf-8");
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      warn(`Could not parse existing ${client.configPath} — will overwrite`);
    }
  }

  const servers = (existing[client.mergeKey] as Record<string, unknown>) ?? {};
  servers["ollama-mcp-bridge"] = buildServerEntry(model, ollamaUrl);
  existing[client.mergeKey] = servers;

  await fs.writeFile(client.configPath, JSON.stringify(existing, null, 2), "utf-8");
}

async function writeTomlConfig(client: ClientDef, model: string, ollamaUrl: string) {
  await ensureDir(path.dirname(client.configPath));

  const escapedPath = SERVER_PATH.replace(/\\/g, "\\\\");
  const block = [
    ``,
    `[mcp_servers.ollama-mcp-bridge]`,
    `command = "node"`,
    `args = ["${escapedPath}"]`,
    `env = { "OLLAMA_BASE_URL" = "${ollamaUrl}", "OLLAMA_DEFAULT_MODEL" = "${model}", "OLLAMA_CONTEXT_WINDOW" = "4096", "OLLAMA_KEEP_ALIVE" = "10m", "BRIDGE_ALLOWED_DIRS" = "${process.cwd().replace(/\\/g, "\\\\")}" }`,
  ].join("\n");

  let existing = "";
  if (await fileExists(client.configPath)) {
    existing = await fs.readFile(client.configPath, "utf-8");
    // Remove any previous ollama-mcp-bridge block
    existing = existing.replace(
      /\n?\[mcp_servers\.ollama-mcp-bridge\][^\[]*/s,
      ""
    );
  }

  await fs.writeFile(client.configPath, existing + block + "\n", "utf-8");
}

async function writeConfigs(detected: ClientDef[], model: string, ollamaUrl: string) {
  step("Writing MCP configurations");

  if (detected.length === 0) {
    // Fallback: write a generic JSON file in cwd
    const out = path.join(process.cwd(), "mcp-config-snippet.json");
    await fs.writeFile(
      out,
      JSON.stringify({ mcpServers: { "ollama-mcp-bridge": buildServerEntry(model, ollamaUrl) } }, null, 2),
      "utf-8"
    );
    ok(`Generic snippet written to ${out}`);
    return;
  }

  for (const client of detected) {
    try {
      if (client.format === "toml") {
        await writeTomlConfig(client, model, ollamaUrl);
      } else {
        await writeJsonConfig(client, model, ollamaUrl);
      }
      ok(`${client.label} → ${client.configPath}`);
    } catch (err) {
      fail(`${client.label} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── step 5: run test_config ──────────────────────────────────────────────────

async function runTests(model: string, ollamaUrl: string) {
  step("Running end-to-end tests");

  // Set env so loadConfig picks up our choices
  process.env["OLLAMA_BASE_URL"]      = ollamaUrl;
  process.env["OLLAMA_DEFAULT_MODEL"] = model;
  process.env["BRIDGE_ALLOWED_DIRS"]  = process.cwd();

  const { loadConfig }            = await import("../config.js");
  const { OllamaClient }          = await import("../ollama/client.js");
  const { Chunker }               = await import("../chunking/index.js");
  const { RequestQueue }          = await import("../queue/request_queue.js");
  const { createTestConfigHandler } = await import("../tools/test_config.js");

  const config       = loadConfig();
  const ollama       = new OllamaClient(config.ollamaBaseUrl, config.keepAlive);
  const chunker      = new Chunker(ollama.generate.bind(ollama));
  const queue        = new RequestQueue(config.numParallel, config.queueMaxSize);
  const handler      = createTestConfigHandler({
    ollamaClient: ollama, chunker, requestQueue: queue,
    defaultModel: config.defaultModel, contextWindow: config.contextWindow,
  });

  const result = await handler({});
  const text   = (result.content[0] as { type: string; text: string }).text;

  // Print each check line with colour
  for (const line of text.split("\n")) {
    if (line.includes("✅")) console.log(`  ${GREEN}${line}${RESET}`);
    else if (line.includes("❌")) console.log(`  ${RED}${line}${RESET}`);
    else if (line.includes("⏭")) console.log(`  ${DIM}${line}${RESET}`);
    else console.log(`  ${line}`);
  }

  return text.includes("All checks passed");
}

// ─── step 6: print system prompt ─────────────────────────────────────────────

function printSystemPrompt(model: string) {
  step("Ready-to-paste system prompt for your orchestrator");

  const prompt = `\
You have access to a local Ollama bridge via the \`ollama-mcp-bridge\` MCP server.
Use it to offload token-expensive tasks to the local model (${model}) instead of processing them yourself.

## When to delegate to the bridge

Delegate these tasks using \`query_local_model\`:
- **Bulk file review** — pass \`context_files\` with source files or directories; ask for findings only
- **Log analysis** — paste raw logs; ask for anomalies and errors only
- **Code summarization** — pass a file; ask for a 3-5 line dense summary
- **Large context tasks** — anything where the input exceeds ~2000 tokens

## How to call it

\`\`\`
query_local_model(
  prompt   = "Review this file for security issues. Return findings only.",
  context_files = ["src/auth/login.ts"]
)
\`\`\`

## Rules for efficient delegation

1. **Never describe what the code does** — ask only for findings, anomalies, or summaries
2. **Use context_files instead of pasting content** — the bridge reads files directly
3. **Keep your prompt short** — the system prompt already instructs the local model to be terse
4. **Check reduction stats** periodically with \`get_reduction_stats\` to see token savings

## Other available tools

| Tool | Use for |
|------|---------|
| \`list_local_models\` | See what models are available |
| \`ping_model\` | Check if a model is warm before a big task |
| \`get_capability_map\` | See/test automatic model routing by task type |
| \`benchmark_models\` | Compare models before choosing one |
| \`test_config\` | Verify the bridge is healthy |
| \`get_reduction_stats\` | Audit token savings over time |`;

  hr();
  console.log(`\n${BOLD}Copy the block below and paste it as your system prompt or into AGENTS.md:${RESET}\n`);
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
  console.log(prompt);
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  console.log(`\n${BOLD}${CYAN}  ollama-mcp-bridge  setup console${RESET}`);
  console.log(`${DIM}  Configures the bridge for every MCP client on this machine${RESET}`);
  hr();

  // Ask for Ollama URL upfront (default is fine for most people)
  const urlAnswer = flags.url || await ask(`Ollama URL [press Enter for ${BOLD}http://localhost:11434${RESET}]:`, "");
  const ollamaUrl = urlAnswer || "http://localhost:11434";

  // 1. Prerequisites
  const prereqOk = await checkPrerequisites(ollamaUrl);
  if (!prereqOk) {
    console.log(`\n${RED}Setup cannot continue. Fix the issues above and re-run.${RESET}\n`);
    process.exit(1);
  }

  // 2. Model selection
  const model = await pickModel(ollamaUrl);

  // 3. Detect clients
  const allClients = getClients();
  const detected   = await detectClients(allClients);

  // 4. Write configs
  await writeConfigs(detected, model, ollamaUrl);

  // 5. Tests
  const passed = await runTests(model, ollamaUrl);

  hr();
  if (passed) {
    console.log(`\n${BOLD}${GREEN}  ✔ Setup complete!${RESET}`);
    if (detected.length > 0) {
      console.log(`\n  Reload MCP servers in your client (e.g. "MCP: Reconnect All Servers")`);
      console.log(`  to activate the bridge.\n`);
    }
  } else {
    console.log(`\n${BOLD}${YELLOW}  ⚠ Setup finished with test failures.${RESET}`);
    console.log(`  Check the output above and re-run once Ollama is healthy.\n`);
  }

  // 6. System prompt
  printSystemPrompt(model);

  console.log(`\n${DIM}  Run again any time: ${BOLD}node dist/cli/setup.js${RESET}\n`);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal:${RESET}`, err instanceof Error ? err.message : err);
  process.exit(1);
});
