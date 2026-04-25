/**
 * MCP tool definitions for the Orchestrama server.
 *
 * Extracted to a separate module so that tests can import the tool list
 * without triggering the side-effectful `main()` call in server.ts.
 *
 * Requirements: 1.1, 1.2, 1.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { PROGRAM_COMMAND_SPECS } from "./tools/context_tools.js";

function createProgramCommandToolDefinition(spec: (typeof PROGRAM_COMMAND_SPECS)[number]) {
  const examples = spec.examples.map((example) => `\`${example}\``).join(" or ");
  return {
    name: spec.toolName,
    description:
      `Run a ${spec.displayName} command in an allowed working directory, then send the bounded output to the local model for interpretation. ` +
      `Pass the arguments after \`${spec.executable}\` in \`command\`, for example ${examples}.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: `What you want the model to answer using the ${spec.displayName} output.`,
        },
        command: {
          type: "string",
          description: `Arguments after \`${spec.executable}\`, e.g. ${examples}.`,
        },
        cwd: {
          type: "string",
          description: "Working directory. Must be within the effective allowed dirs.",
        },
        max_output_chars: {
          type: "number",
          description: "Maximum output characters sent to the model, from 1000 to 64000. Defaults to 12000.",
        },
        model: { type: "string", description: "Override the model to use (optional)." },
        intent: { type: "string", description: "Optional intent pattern for the model response." },
        system_prompt: { type: "string", description: "Optional system prompt override." },
        options: {
          type: "object",
          description: "Optional Ollama model options; same shape as query_local_model options.",
        },
      },
      required: ["prompt", "command"],
    },
  };
}

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
          description: "Working directory for the command. Must be within the effective allowed dirs, including directories declared with declare_working_dirs. Defaults to the bridge's cwd.",
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
    name: "rg_search",
    description:
      "Search the current project with ripgrep (`rg`), then send the bounded search output to the local model for interpretation. " +
      "Use this when the AI needs to find files, symbols, references, TODOs, errors, or relevant code context before answering. " +
      "The `prompt` describes what the caller wants to learn from the matches; Orchestrama gathers the matches and asks the model to answer from that context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "What you want the model to answer using the rg results.",
        },
        pattern: {
          type: "string",
          description: "Ripgrep search pattern.",
        },
        cwd: {
          type: "string",
          description: "Directory to search. Must be within the effective allowed dirs.",
        },
        globs: {
          type: "array",
          items: { type: "string" },
          description: "Optional rg glob filters, e.g. ['*.ts', '!dist/**'].",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether the search is case-sensitive. Defaults to true.",
        },
        context_lines: {
          type: "number",
          description: "Number of surrounding lines to include per match, from 0 to 20. Defaults to 0.",
        },
        max_output_chars: {
          type: "number",
          description: "Maximum rg output characters to send to the model, from 1000 to 64000. Defaults to 12000.",
        },
        model: { type: "string", description: "Override the model to use (optional)." },
        intent: { type: "string", description: "Optional intent pattern for the model response." },
        system_prompt: { type: "string", description: "Optional system prompt override." },
        options: {
          type: "object",
          description: "Optional Ollama model options; same shape as query_local_model options.",
        },
      },
      required: ["prompt", "pattern"],
    },
  },
  {
    name: "gh_command",
    description:
      "Run a GitHub CLI (`gh`) command with structured arguments, then send the bounded command output to the local model for interpretation. " +
      "Use this for PRs, issues, releases, workflow runs, repository metadata, and other GitHub context. " +
      "The command is executed without a shell; pass only the arguments after `gh`.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "What you want the model to answer using the gh output.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments after `gh`, e.g. ['pr', 'view', '123', '--comments'].",
        },
        cwd: {
          type: "string",
          description: "Working directory for gh. Must be within the effective allowed dirs.",
        },
        max_output_chars: {
          type: "number",
          description: "Maximum gh output characters to send to the model, from 1000 to 64000. Defaults to 12000.",
        },
        model: { type: "string", description: "Override the model to use (optional)." },
        intent: { type: "string", description: "Optional intent pattern for the model response." },
        system_prompt: { type: "string", description: "Optional system prompt override." },
        options: {
          type: "object",
          description: "Optional Ollama model options; same shape as query_local_model options.",
        },
      },
      required: ["prompt", "args"],
    },
  },
  {
    name: "get_content",
    description:
      "Read one or more files or directories from the effective allowed dirs and send their contents to the local model with the caller's prompt. " +
      "Use this as a direct Get-Content style tool when exact file content is needed before answering.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "What you want the model to answer using the file contents.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Files or directories to read as context.",
        },
        model: { type: "string", description: "Override the model to use (optional)." },
        intent: { type: "string", description: "Optional intent pattern for the model response." },
        system_prompt: { type: "string", description: "Optional system prompt override." },
        options: {
          type: "object",
          description: "Optional Ollama model options; same shape as query_local_model options.",
        },
      },
      required: ["prompt", "paths"],
    },
  },
  ...PROGRAM_COMMAND_SPECS.map(createProgramCommandToolDefinition),
  {
    name: "declare_working_dirs",
    description:
      "Declare additional working directories for this session at runtime. " +
      "The AI client calls this tool once per session to register directories it needs to access. " +
      "Declared directories are merged with the static BRIDGE_ALLOWED_DIRS configuration and remain active for the session lifetime. " +
      "\n\n" +
      "Security model:\n" +
      "- Any existing directory can be declared at runtime.\n" +
      "- Declared directories are session-scoped and become part of the effective allowed directory set.\n" +
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
