import { promises as fs } from "fs";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { UsagePattern, PersistedPattern } from "../types.js";
import type { IOllamaClient } from "../ollama/client.js";

export interface PatternRegistryOptions {
  patternsFilePath?: string;
  ollamaClient?: IOllamaClient;
  defaultModel?: string;
}

/** Immutable built-in pattern definitions */
const BUILT_IN_PATTERNS: UsagePattern[] = [
  {
    name: "code_review",
    description: "Review code for issues, risks, and improvement suggestions",
    systemPrompt:
      "Return only a bullet list of findings: issues, risks, suggestions. " +
      "One bullet per finding. Include file location when available. " +
      "No preamble. No summary. No explanation of what the code does. " +
      "If nothing to report, output only: 'No findings.'",
    keywords: ["review", "code review", "refactor", "lint"],
    isBuiltIn: true,
  },
  {
    name: "explain_code",
    description: "Explain what code does in plain language",
    systemPrompt:
      "Explain what the code does in plain language. " +
      "State the purpose and key behaviour only. Maximum 5 sentences. " +
      "No preamble. No implementation details unless essential.",
    keywords: ["explain", "what does", "how does", "understand"],
    isBuiltIn: true,
  },
  {
    name: "find_bugs",
    description: "Find confirmed or likely bugs in code",
    systemPrompt:
      "List only confirmed or likely bugs. " +
      "For each: file location (if available), one-line description, reason it is a bug. " +
      "No style issues. No suggestions. No preamble. " +
      "If no bugs found, output only: 'No bugs found.'",
    keywords: ["bugs", "defects", "issues", "problems"],
    isBuiltIn: true,
  },
  {
    name: "find_ts_errors",
    description: "Find TypeScript type errors, missing imports, and type mismatches",
    systemPrompt:
      "Report only TypeScript type errors, missing imports, and type mismatches. " +
      "For each: file location, error message, expected vs actual type. " +
      "No style issues. No logic bugs. No suggestions. No preamble. " +
      "If no errors found, output only: 'No TypeScript errors found.'",
    keywords: ["typescript", "ts errors", "type errors", "missing imports"],
    isBuiltIn: true,
  },
  {
    name: "generate_tests",
    description: "Generate test code for the given code",
    systemPrompt:
      "Output only test code. No explanation. No markdown fences unless part of the file. " +
      "Cover main functionality and key edge cases. No preamble.",
    keywords: ["generate tests", "write tests", "test cases", "unit tests"],
    isBuiltIn: true,
  },
  {
    name: "log_analysis",
    description: "Analyse logs and return only anomalies, errors, and patterns",
    systemPrompt:
      "Return only anomalies, errors, and notable patterns. " +
      "For each: timestamp (if present), severity, one-line description. " +
      "Ignore routine info entries. No preamble. " +
      "If nothing found, output only: 'No anomalies found.'",
    keywords: ["log", "logs", "error log", "trace", "debug"],
    isBuiltIn: true,
  },
  {
    name: "replace_text",
    description: "Apply text replacements and output only the modified text",
    systemPrompt:
      "Output only the modified text with all replacements applied. " +
      "No explanation. No diff markers. Preserve all formatting not part of the replacement.",
    keywords: ["replace", "substitution", "find and replace"],
    isBuiltIn: true,
  },
  {
    name: "summarize",
    description: "Summarize content into 3–5 lines of dense summary",
    systemPrompt:
      "Output 3–5 lines of dense summary. Key points, decisions, outcomes only. " +
      "Plain prose. No headings. No bullets. No preamble.",
    keywords: ["summarize", "summary", "tldr", "brief"],
    isBuiltIn: true,
  },
];

/** Sorted built-in names for fast lookup */
const BUILT_IN_NAMES = new Set(BUILT_IN_PATTERNS.map((p) => p.name.toLowerCase()));

export class PatternRegistry {
  private readonly patternsFilePath: string | undefined;
  private readonly ollamaClient: IOllamaClient | undefined;
  private readonly defaultModel: string;
  private customPatterns: Map<string, UsagePattern> = new Map();

  constructor(options: PatternRegistryOptions = {}) {
    this.patternsFilePath = options.patternsFilePath;
    this.ollamaClient = options.ollamaClient;
    this.defaultModel = options.defaultModel ?? "llama3.1:8b";
  }

  /**
   * Returns all patterns: built-ins first (alphabetical), then customs (alphabetical).
   * When filter is provided, returns only patterns whose name or description contains
   * the filter string (case-insensitive).
   */
  list(filter?: string): UsagePattern[] {
    const builtIns = [...BUILT_IN_PATTERNS].sort((a, b) => a.name.localeCompare(b.name));
    const customs = [...this.customPatterns.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const all = [...builtIns, ...customs];

    if (!filter || filter.trim() === "") {
      return all;
    }

    const lowerFilter = filter.toLowerCase();
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerFilter) ||
        p.description.toLowerCase().includes(lowerFilter)
    );
  }

  /**
   * Returns a pattern by name (case-insensitive), or undefined if not found.
   */
  get(name: string): UsagePattern | undefined {
    const lower = name.toLowerCase();
    const builtIn = BUILT_IN_PATTERNS.find((p) => p.name.toLowerCase() === lower);
    if (builtIn) return builtIn;
    return this.customPatterns.get(lower);
  }

  /**
   * Returns true if the name belongs to a built-in pattern (case-insensitive).
   */
  isBuiltIn(name: string): boolean {
    return BUILT_IN_NAMES.has(name.toLowerCase());
  }

  /**
   * Registers a new custom pattern. Derives systemPrompt from description using
   * the local Ollama model. Rejects if name is empty, description is empty, or
   * name matches a built-in pattern. Overwrites existing custom pattern with the
   * same name. Persists to file if patternsFilePath is configured.
   */
  async register(name: string, description: string): Promise<UsagePattern> {
    // Validate name
    if (!name || name.trim() === "") {
      throw new McpError(ErrorCode.InvalidParams, "Pattern name must be a non-empty string");
    }

    // Validate description
    if (!description || description.trim() === "") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Pattern description must be a non-empty string"
      );
    }

    // Reject built-in names
    if (this.isBuiltIn(name)) {
      const builtInList = BUILT_IN_PATTERNS.map((p) => p.name)
        .sort()
        .join(", ");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Cannot overwrite built-in pattern: ${name}. Built-in patterns are: ${builtInList}`
      );
    }

    // Derive system prompt from description using Ollama
    const systemPrompt = await this.deriveSystemPrompt(description);

    const pattern: UsagePattern = {
      name: name.trim(),
      description: description.trim(),
      systemPrompt,
      keywords: [],
      isBuiltIn: false,
    };

    // Store using lowercase key for case-insensitive lookup
    this.customPatterns.set(name.toLowerCase(), pattern);

    // Persist to file if configured
    await this.persistToFile();

    return pattern;
  }

  /**
   * Loads custom patterns from BRIDGE_PATTERNS_FILE at startup.
   * Logs a warning to stderr on invalid JSON and starts with empty custom patterns.
   */
  async loadFromFile(): Promise<void> {
    if (!this.patternsFilePath) return;

    let raw: string;
    try {
      raw = await fs.readFile(this.patternsFilePath, "utf-8");
    } catch {
      // File doesn't exist yet — that's fine, start empty
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      process.stderr.write(
        "[ollama-mcp-bridge] WARNING: BRIDGE_PATTERNS_FILE contains invalid JSON, starting with empty custom patterns\n"
      );
      return;
    }

    if (!Array.isArray(parsed)) {
      process.stderr.write(
        "[ollama-mcp-bridge] WARNING: BRIDGE_PATTERNS_FILE contains invalid JSON, starting with empty custom patterns\n"
      );
      return;
    }

    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as PersistedPattern).name === "string" &&
        typeof (item as PersistedPattern).description === "string" &&
        typeof (item as PersistedPattern).systemPrompt === "string" &&
        Array.isArray((item as PersistedPattern).keywords)
      ) {
        const p = item as PersistedPattern;
        const pattern: UsagePattern = {
          name: p.name,
          description: p.description,
          systemPrompt: p.systemPrompt,
          keywords: p.keywords,
          isBuiltIn: false,
          ...(p.modelPreference !== undefined ? { modelPreference: p.modelPreference } : {}),
        };
        this.customPatterns.set(p.name.toLowerCase(), pattern);
      }
    }
  }

  /** Derives a system prompt from a description using the local Ollama model. */
  private async deriveSystemPrompt(description: string): Promise<string> {
    if (!this.ollamaClient) {
      // No client configured — use description as-is
      return description;
    }

    const prompt =
      `You are a system prompt engineer. Given the following description of a task, ` +
      `produce a concise, precise system prompt instruction set for a language model. ` +
      `The system prompt should tell the model exactly what to do and what format to use. ` +
      `Output only the system prompt text, with no preamble or explanation.\n\n` +
      `Task description: ${description}`;

    try {
      const response = await this.ollamaClient.generate({
        model: this.defaultModel,
        prompt,
      });
      return response.response.trim() || description;
    } catch {
      // If Ollama is unavailable, fall back to using the description directly
      return description;
    }
  }

  /** Writes all custom patterns to the configured file path. */
  private async persistToFile(): Promise<void> {
    if (!this.patternsFilePath) return;

    const persisted: PersistedPattern[] = [...this.customPatterns.values()].map((p) => ({
      name: p.name,
      description: p.description,
      systemPrompt: p.systemPrompt,
      keywords: p.keywords,
      ...(p.modelPreference !== undefined ? { modelPreference: p.modelPreference } : {}),
    }));

    try {
      await fs.writeFile(this.patternsFilePath, JSON.stringify(persisted, null, 2), "utf-8");
    } catch (err) {
      process.stderr.write(
        `[ollama-mcp-bridge] WARNING: Failed to persist patterns to ${this.patternsFilePath}: ${err}\n`
      );
    }
  }
}
