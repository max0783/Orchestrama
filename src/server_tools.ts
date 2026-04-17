/**
 * MCP tool definitions for the ollama-mcp-bridge server.
 *
 * Extracted to a separate module so that tests can import the tool list
 * without triggering the side-effectful `main()` call in server.ts.
 *
 * Requirements: 1.1, 1.2, 1.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

export const TOOL_DEFINITIONS = [
  {
    name: "query_local_model",
    description:
      "Send a prompt to a local Ollama model, optionally with context files. Supports Map-Reduce chunking for large payloads. " +
      "Enforces bridge limits for context files (count, per-file tokens, and total context tokens). " +
      "Use the `intent` parameter to select a usage pattern by name or keyword. " +
      "Built-in patterns: find_ts_errors, replace_text, find_bugs, code_review, summarize, log_analysis, explain_code, generate_tests.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "The prompt to send to the local model" },
        model: { type: "string", description: "Override the model to use (optional)" },
        context_files: {
          type: "array",
          items: { type: "string" },
          description: "File or directory paths to include as context (optional)",
        },
        system_prompt: {
          type: "string",
          description: "Override the system prompt for this invocation (optional)",
        },
        intent: {
          type: "string",
          description:
            "Optional intent string to select a usage pattern. Built-in patterns: find_ts_errors, replace_text, find_bugs, code_review, summarize, log_analysis, explain_code, generate_tests. You can also use keywords like 'typescript errors', 'code review', 'summarize', etc.",
        },
        options: {
          type: "object",
          description:
            "Optional model fine-tuning parameters for this call. Overrides any defaults set in the bridge config. " +
            "Supported fields: temperature (0.0–2.0), top_p (0.0–1.0), top_k (integer), repeat_penalty (float), " +
            "seed (integer, -1 = random), num_predict (integer, -1 = model default), min_p (0.0–1.0), tfs_z (float).",
          properties: {
            temperature: { type: "number", description: "Sampling temperature (0.0–2.0). Lower = more deterministic." },
            top_p: { type: "number", description: "Top-p nucleus sampling (0.0–1.0)." },
            top_k: { type: "number", description: "Top-k sampling. 0 = disabled." },
            repeat_penalty: { type: "number", description: "Penalty for repeated tokens (1.0 = no penalty)." },
            seed: { type: "number", description: "Fixed random seed for reproducible outputs. -1 = random." },
            num_predict: { type: "number", description: "Maximum tokens to generate. -1 = model default." },
            min_p: { type: "number", description: "Minimum probability for a token to be considered." },
            tfs_z: { type: "number", description: "Tail-free sampling parameter." },
          },
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ping_model",
    description:
      "Ping a local Ollama model to check its load status (warm/cold) and measure round-trip response time. " +
      "A warm start means the model is already loaded in memory; a cold start means it needs to be loaded first. " +
      "Use this before sending large queries to confirm the model is ready.",
    inputSchema: {
      type: "object" as const,
      properties: {
        model: { type: "string", description: "Model to ping (defaults to the configured default model)" },
      },
    },
  },
  {
    name: "list_patterns",
    description:
      "List all available usage patterns (built-in and custom). Returns each pattern's name, description, keywords, and whether it is built-in or custom. Use the pattern names with the intent parameter of query_local_model.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          description: "Optional filter string — only patterns whose name or description contains this string (case-insensitive) are returned.",
        },
      },
    },
  },
  {
    name: "register_pattern",
    description:
      "Register a new custom usage pattern. Provide a name and a plain-language description of the pattern's intent. " +
      "The bridge will automatically refine the description into a concise system prompt using the local model. " +
      "The pattern is immediately available for use with query_local_model after registration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Unique name for the pattern (kebab-case recommended, e.g. 'my-pattern').",
        },
        description: {
          type: "string",
          description: "Plain-language description of the pattern's intent. The bridge will refine this into a system prompt.",
        },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "get_bridge_limits",
    description:
      "Return the bridge's enforced limits and context configuration (context window, max files, per-file token cap, and total context token cap). " +
      "Call this before sending context_files to avoid rejections.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "setup_bridge",
    description:
      "Generate the MCP configuration snippet for any supported client (JSON for most clients, TOML for codex) AND output a usage prompt describing all available tools and patterns in a single call. " +
      "Supported clients: claude-desktop, claude-code, kiro, cursor, codex, generic. Defaults to generic if no client is specified.",
    inputSchema: {
      type: "object" as const,
      properties: {
        client: {
          type: "string",
          description:
            "Target MCP client. One of: claude-desktop, claude-code, kiro, cursor, codex, generic. Defaults to generic.",
        },
        run_checks: {
          type: "boolean",
          description:
            "When true, runs health checks (Ollama connectivity, default model existence) and includes results in the output.",
        },
        include_env: {
          type: "boolean",
          description:
            "When true, includes all configurable environment variables with their current values in the config JSON output.",
        },
      },
    },
  },
];
