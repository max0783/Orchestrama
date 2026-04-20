#!/usr/bin/env node
/**
 * generate-config CLI
 *
 * Generates MCP configuration JSON snippets for supported clients.
 * Usage:
 *   generate-config [--client <name>] [--env KEY=VALUE ...]
 *
 * Supported clients: claude-desktop, claude-code, kiro, cursor, codex, generic
 */

import { parseArgs } from "node:util";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

// ---------------------------------------------------------------------------
// Resolve __dirname in ESM context
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    client: { type: "string" },
    env: { type: "string", multiple: true },
  },
  allowPositionals: false,
});

// ---------------------------------------------------------------------------
// Build env overrides from --env KEY=VALUE pairs
// ---------------------------------------------------------------------------

const envOverrides: Record<string, string> = {};
for (const pair of values.env ?? []) {
  const eqIdx = pair.indexOf("=");
  if (eqIdx > 0) {
    const key = pair.slice(0, eqIdx);
    const val = pair.slice(eqIdx + 1);
    envOverrides[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Helper: get effective env value (--env overrides take precedence)
// ---------------------------------------------------------------------------

function getEnv(key: string, defaultValue: string): string {
  return envOverrides[key] ?? process.env[key] ?? defaultValue;
}

// ---------------------------------------------------------------------------
// Generate the MCP server snippet
// ---------------------------------------------------------------------------

function generateJsonSnippet(): object {
  const serverPath = path.resolve(__dirname, "../../dist/server.js");
  return {
    mcpServers: {
      "ollama-mcp-bridge": {
        command: "node",
        args: [serverPath],
        env: {
          OLLAMA_BASE_URL: getEnv("OLLAMA_BASE_URL", "http://localhost:11434"),
          OLLAMA_DEFAULT_MODEL: getEnv("OLLAMA_DEFAULT_MODEL", "llama3.1:8b"),
          OLLAMA_CONTEXT_WINDOW: getEnv("OLLAMA_CONTEXT_WINDOW", "4096"),
          OLLAMA_KEEP_ALIVE: getEnv("OLLAMA_KEEP_ALIVE", "10m"),
        },
      },
    },
  };
}

/** Generate a TOML snippet for Codex CLI (~/.codex/config.toml). */
function generateTomlSnippet(): string {
  const serverPath = path.resolve(__dirname, "../../dist/server.js").replace(/\\/g, "\\\\");
  const ollamaBaseUrl = getEnv("OLLAMA_BASE_URL", "http://localhost:11434");
  const defaultModel = getEnv("OLLAMA_DEFAULT_MODEL", "llama3.1:8b");
  const contextWindow = getEnv("OLLAMA_CONTEXT_WINDOW", "4096");
  const keepAlive = getEnv("OLLAMA_KEEP_ALIVE", "10m");

  return [
    `[mcp_servers.ollama-mcp-bridge]`,
    `command = "node"`,
    `args = ["${serverPath}"]`,
    `env = { "OLLAMA_BASE_URL" = "${ollamaBaseUrl}", "OLLAMA_DEFAULT_MODEL" = "${defaultModel}", "OLLAMA_CONTEXT_WINDOW" = "${contextWindow}", "OLLAMA_KEEP_ALIVE" = "${keepAlive}" }`,
  ].join("\n");
}

function generateSnippet(): object {
  return generateJsonSnippet();
}

// ---------------------------------------------------------------------------
// OS-specific config file paths per client
// ---------------------------------------------------------------------------

function getConfigPath(client: string): string {
  const platform = process.platform;
  const home = os.homedir();

  // Helper to build Windows %APPDATA% path
  const appData = process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");

  switch (client) {
    case "claude-desktop":
      if (platform === "win32") {
        return path.join(appData, "Claude", "claude_desktop_config.json");
      } else if (platform === "darwin") {
        return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      } else {
        return path.join(home, ".config", "claude", "claude_desktop_config.json");
      }

    case "claude-code":
      return path.join(home, ".claude.json");

    case "kiro":
      // Kiro uses ~/.kiro/settings/mcp.json (user home, not AppData)
      return path.join(home, ".kiro", "settings", "mcp.json");

    case "cursor":
      if (platform === "win32") {
        return path.join(appData, "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json");
      } else if (platform === "darwin") {
        return path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json");
      } else {
        return path.join(home, ".config", "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json");
      }

    case "codex":
      // OpenAI Codex CLI uses ~/.codex/config.toml (TOML format, all platforms)
      return path.join(home, ".codex", "config.toml");

    case "generic":
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Print snippet for a single client
// ---------------------------------------------------------------------------

function printForClient(client: string): void {
  const configPath = getConfigPath(client);

  console.log(`\n# Client: ${client}`);
  if (configPath) {
    console.log(`# Config file: ${configPath}`);
  }

  if (client === "codex") {
    // Codex uses TOML format
    console.log(`# Format: TOML — append this block to ~/.codex/config.toml`);
    console.log(generateTomlSnippet());
  } else {
    console.log(JSON.stringify(generateSnippet(), null, 2));
  }
}

// ---------------------------------------------------------------------------
// Supported clients
// ---------------------------------------------------------------------------

const SUPPORTED_CLIENTS = ["claude-desktop", "claude-code", "kiro", "cursor", "codex", "generic"] as const;
type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];

function isSupportedClient(value: string): value is SupportedClient {
  return (SUPPORTED_CLIENTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

const clientArg = values.client;

if (clientArg !== undefined) {
  // --client specified: validate and print for that client only
  if (!isSupportedClient(clientArg)) {
    process.stderr.write(
      `Error: Unsupported client "${clientArg}". Supported clients: ${SUPPORTED_CLIENTS.join(", ")}\n`
    );
    process.exit(1);
  }
  printForClient(clientArg);
} else {
  // No --client: print all clients sequentially
  for (const client of SUPPORTED_CLIENTS) {
    printForClient(client);
  }
}
