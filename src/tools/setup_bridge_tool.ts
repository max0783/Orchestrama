/**
 * SetupTool — generates the setup_bridge output.
 *
 * Produces a client-specific MCP config snippet and a machine-readable
 * usage prompt that describes all available tools and patterns. Optionally
 * runs health checks against the local Ollama instance.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 7.1, 7.2, 7.3, 7.4
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import type { PatternRegistry } from "../patterns/registry.js";
import type { IOllamaClient } from "../ollama/client.js";
import type { BridgeConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SupportedClient =
  | "claude-desktop"
  | "claude-code"
  | "kiro"
  | "cursor"
  | "codex"
  | "generic";

export const SUPPORTED_CLIENTS: SupportedClient[] = [
  "claude-desktop",
  "claude-code",
  "kiro",
  "cursor",
  "codex",
  "generic",
];

export interface SetupToolOptions {
  registry: PatternRegistry;
  ollamaClient: IOllamaClient;
  config: BridgeConfig;
}

export interface SetupResult {
  /** Copy-pasteable MCP config snippet for the requested client. */
  configSnippet: string;
  /** Config snippet format. */
  configFormat: "json" | "toml";
  /** Backward-compatible alias for callers that still read configJson. */
  configJson: string;
  /** Machine-readable tool + pattern description for the orchestrator. */
  usagePrompt: string;
  /** Present only when run_checks: true. */
  healthChecks?: HealthCheckResult[];
}

export interface HealthCheckResult {
  name: string;
  passed: boolean;
  detail: string;
  /** Present when passed === false. */
  resolutionHint?: string;
}

// ---------------------------------------------------------------------------
// MCP tool names used in the usage prompt
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: "query_local_model",
    description:
      "Send a prompt to a local Ollama model, optionally with context files. " +
      "Supports Map-Reduce chunking for large payloads. " +
      "Use the `intent` parameter to select a usage pattern by name or keyword.",
    params:
      "prompt (required), model (optional), context_files (optional), system_prompt (optional), intent (optional)",
  },
  {
    name: "ping_model",
    description:
      "Ping a local Ollama model to check its load status (warm/cold) and measure " +
      "round-trip response time. Use before sending large queries to confirm the model is loaded.",
    params: "model (optional, defaults to configured default model)",
  },
  {
    name: "list_patterns",
    description:
      "List all available usage patterns (built-in and custom). " +
      "Use the returned pattern names with the `intent` parameter of query_local_model.",
    params: "filter (optional string)",
  },
  {
    name: "register_pattern",
    description:
      "Register a new custom usage pattern. The bridge will automatically refine " +
      "the description into a system prompt using the local model.",
    params: "name (required), description (required)",
  },
  {
    name: "get_bridge_limits",
    description:
      "Return the bridge's enforced context limits (max files, per-file token cap, total context token cap, and context window). " +
      "Use this before sending context_files to avoid rejections and keep calls efficient.",
    params: "(no parameters)",
  },
  {
    name: "setup_bridge",
    description:
      "Generate the MCP configuration snippet for any supported client AND output a " +
      "usage prompt describing all tools and patterns in a single call.",
    params: "client (optional), run_checks (optional boolean), include_env (optional boolean)",
  },
];

// ---------------------------------------------------------------------------
// SetupTool class
// ---------------------------------------------------------------------------

export class SetupTool {
  private readonly registry: PatternRegistry;
  private readonly ollamaClient: IOllamaClient;
  private readonly config: BridgeConfig;

  constructor(options: SetupToolOptions) {
    this.registry = options.registry;
    this.ollamaClient = options.ollamaClient;
    this.config = options.config;
  }

  /**
   * Generates the setup output for the given client.
   *
   * @throws McpError(InvalidParams) when `client` is not in SUPPORTED_CLIENTS.
   */
  async generate(
    client: SupportedClient,
    options?: {
      runChecks?: boolean;
      includeEnv?: boolean;
    }
  ): Promise<SetupResult> {
    // Validate client
    if (!SUPPORTED_CLIENTS.includes(client)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unsupported client: ${client}. Supported clients: ${SUPPORTED_CLIENTS.join(", ")}`
      );
    }

    const runChecks = options?.runChecks ?? false;
    const includeEnv = options?.includeEnv ?? false;

    const { snippet, format } = this.buildConfigSnippet(client, includeEnv);
    const usagePrompt = this.buildUsagePrompt();

    const result: SetupResult = {
      configSnippet: snippet,
      configFormat: format,
      configJson: snippet,
      usagePrompt,
    };

    if (runChecks) {
      result.healthChecks = await this.runHealthChecks();
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildConfigSnippet(
    client: SupportedClient,
    includeEnv: boolean
  ): { snippet: string; format: "json" | "toml" } {
    const serverPath = this.resolveServerPath();

    const serverConfig: Record<string, unknown> = {
      command: "node",
      args: [serverPath],
    };

    if (includeEnv) {
      const env: Record<string, string> = {
        OLLAMA_BASE_URL: this.config.ollamaBaseUrl,
        OLLAMA_DEFAULT_MODEL: this.config.defaultModel,
        OLLAMA_CONTEXT_WINDOW: String(this.config.contextWindow),
        OLLAMA_KEEP_ALIVE: this.config.keepAlive,
        OLLAMA_NUM_PARALLEL: String(this.config.numParallel),
        BRIDGE_QUEUE_MAX_SIZE: String(this.config.queueMaxSize),
        BRIDGE_REQUEST_TIMEOUT_MS: String(this.config.requestTimeoutMs),
        BRIDGE_REDUCTION_LOG: this.config.reductionLogPath,
        BRIDGE_LOG_LEVEL: this.config.logLevel,
        BRIDGE_DISABLE_PROGRESS: String(this.config.disableProgress),
        BRIDGE_KEEPALIVE_ON_START: String(this.config.keepAliveOnStart),
        BRIDGE_ALLOWED_DIRS: this.config.allowedDirs.join(","),
        BRIDGE_CAPABILITY_MAP: JSON.stringify(this.config.capabilityMap),
        BRIDGE_FALLBACK_MODELS: this.config.fallbackModels.join(","),
        BRIDGE_SYSTEM_PROMPT: this.config.systemPrompt,
        BRIDGE_MAX_CONTEXT_FILES: String(this.config.maxContextFiles ?? 20),
        BRIDGE_MAX_FILE_TOKENS: String(this.config.maxFileTokens ?? 1024),
        BRIDGE_MAX_TOTAL_CONTEXT_TOKENS: String(
          this.config.maxTotalContextTokens ?? 4096
        ),
      };

      if (this.config.patternsFilePath !== undefined) {
        env["BRIDGE_PATTERNS_FILE"] = this.config.patternsFilePath;
      }

      serverConfig["env"] = env;
    }

    if (client === "codex") {
      const escapedPath = serverPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const lines = [
        `[mcp_servers.ollama-mcp-bridge]`,
        `command = "node"`,
        `args = ["${escapedPath}"]`,
      ];

      if (includeEnv) {
        const envEntries = Object.entries(serverConfig["env"] as Record<string, string>)
          .map(
            ([key, value]) =>
              `"${key}" = "${value
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')}"`
          )
          .join(", ");
        lines.push(`env = { ${envEntries} }`);
      }

      return { snippet: lines.join("\n"), format: "toml" };
    }

    const mcpConfig = {
      mcpServers: {
        "ollama-mcp-bridge": serverConfig,
      },
    };

    return { snippet: JSON.stringify(mcpConfig, null, 2), format: "json" };
  }

  private resolveServerPath(): string {
    const argvEntry = process.argv[1];
    if (argvEntry && /(\\|\/)server\.(js|ts)$/i.test(argvEntry)) {
      return path.resolve(argvEntry);
    }
    return path.resolve(process.cwd(), "dist", "server.js");
  }

  private buildUsagePrompt(): string {
    const lines: string[] = [];

    // ---- Tools section ----
    lines.push("=== MCP TOOLS ===");
    lines.push("");

    for (const tool of MCP_TOOLS) {
      lines.push(`Tool: ${tool.name}`);
      lines.push(`  Description: ${tool.description}`);
      lines.push(`  Parameters: ${tool.params}`);
      lines.push("");
    }

    // ---- Patterns section ----
    const patterns = this.registry.list();
    lines.push("=== USAGE PATTERNS ===");
    lines.push("");
    lines.push(
      "Use these pattern names (or their keywords) as the `intent` parameter of query_local_model."
    );
    lines.push("");

    for (const pattern of patterns) {
      const tag = pattern.isBuiltIn ? "[BUILT-IN]" : "[CUSTOM]";
      lines.push(`${tag} ${pattern.name}`);
      lines.push(`  Description: ${pattern.description}`);
      if (pattern.keywords.length > 0) {
        lines.push(`  Keywords: ${pattern.keywords.join(", ")}`);
      }
      lines.push("");
    }

    // ---- Intent usage explanation ----
    lines.push("=== HOW TO USE INTENT PARAMETER ===");
    lines.push("");
    lines.push(
      "Pass `intent` to query_local_model to automatically select the right system prompt and model."
    );
    lines.push("Examples:");
    lines.push('  { "prompt": "<code>", "intent": "find_ts_errors" }');
    lines.push('  { "prompt": "<code>", "intent": "code review" }');
    lines.push('  { "prompt": "<text>", "intent": "summarize" }');
    lines.push(
      "If the intent does not match any pattern, the bridge falls back to automatic task-type detection."
    );

    return lines.join("\n");
  }

  private async runHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    // Check 1: Ollama connectivity
    let ollamaReachable = false;
    try {
      await this.ollamaClient.listModels();
      ollamaReachable = true;
      results.push({
        name: "ollama_connectivity",
        passed: true,
        detail: "Ollama is reachable and returned a model list.",
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({
        name: "ollama_connectivity",
        passed: false,
        detail: `Ollama is not reachable: ${detail}`,
        resolutionHint: "Ensure Ollama is running: `ollama serve`",
      });
    }

    // Check 2: Default model exists (only attempt if Ollama is reachable)
    if (ollamaReachable) {
      try {
        await this.ollamaClient.ping(this.config.defaultModel);
        results.push({
          name: "default_model_exists",
          passed: true,
          detail: `Default model "${this.config.defaultModel}" is available.`,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        results.push({
          name: "default_model_exists",
          passed: false,
          detail: `Default model "${this.config.defaultModel}" is not available: ${detail}`,
          resolutionHint: `Run: ollama pull ${this.config.defaultModel}`,
        });
      }
    } else {
      // Ollama unreachable — report model check as failed too
      results.push({
        name: "default_model_exists",
        passed: false,
        detail: `Cannot check model "${this.config.defaultModel}" because Ollama is unreachable.`,
        resolutionHint: `Run: ollama pull ${this.config.defaultModel}`,
      });
    }

    return results;
  }
}
