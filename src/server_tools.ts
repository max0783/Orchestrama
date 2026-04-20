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
    name: "run_command",
    description:
      "Execute a shell command, capture its output, and send it to the local Ollama model for interpretation. " +
      "Provide a prompt (what you want to know), a command (what to run), and expected_output (what the output should contain). " +
      "The bridge runs the command, feeds the output to the model, and returns a concise answer. " +
      "\n\n" +
      "Common repo-inspection examples (pipe or flag to limit output):\n" +
      "- `rg \"TODO\" --type ts -l` — list TypeScript files containing TODO\n" +
      "- `git log --oneline --max-count=20 -- src/` — last 20 commits touching src/\n" +
      "- `git diff HEAD~1 --stat` — files changed in the last commit\n" +
      "- `git blame -l src/config.ts` — line-by-line authorship\n" +
      "- `gh pr list --limit 10` — recent pull requests\n" +
      "- `git show HEAD:src/config.ts` — file content at HEAD\n" +
      "\n" +
      "Always use flags that limit output (`--max-count`, `--oneline`, `-l`, `--stat`) before the token budget is exceeded. " +
      "The working directory defaults to the bridge's cwd; override with the optional cwd parameter. " +
      "Refuses if the command output exceeds the token budget.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "What you want to know or do with the command output.",
        },
        command: {
          type: "string",
          description: "The shell command to execute.",
        },
        expected_output: {
          type: "string",
          description: "Description of what the command output should contain (used to frame the model's interpretation).",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command. Must be within BRIDGE_ALLOWED_DIRS. Defaults to the bridge's cwd.",
        },
        model: {
          type: "string",
          description: "Override the model to use (optional).",
        },
      },
      required: ["prompt", "command", "expected_output"],
    },
  },
  {
    name: "declare_working_dirs",
    description:
      "Declare additional working directories for this session at runtime. " +
      "The AI client calls this tool once per session to register directories it needs to access. " +
      "Declared directories are merged with the static BRIDGE_ALLOWED_DIRS configuration and remain active for the session lifetime. " +
      "\n\n" +
      "Security model:\n" +
      "- When BRIDGE_ALLOWED_DIRS is NOT set (default): any existing directory can be declared.\n" +
      "- When BRIDGE_ALLOWED_DIRS IS set: declared directories must be subdirectories of the configured static dirs. " +
      "This ensures the operator's security boundary is always respected.\n" +
      "\n" +
      "Idempotent behavior:\n" +
      "- Calling this tool multiple times merges paths without duplicates (union semantics).\n" +
      "- Paths are normalized and resolved to absolute paths before storage.\n" +
      "\n" +
      "Returns accepted paths, rejected paths with reasons, and the effective directory list (static + dynamic).",
    inputSchema: {
      type: "object" as const,
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Absolute directory paths to add to this session's allowed dirs.",
        },
      },
      required: ["paths"],
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
