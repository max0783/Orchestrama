import fs from "fs";
import path from "path";
import type { BridgeConfig, CapabilityMap, ModelOptions } from "./types.js";

export const DEFAULT_MAX_CONTEXT_FILES = 20;
export const DEFAULT_MAX_FILE_TOKENS = 1024;
export const DEFAULT_MAX_TOTAL_CONTEXT_TOKENS = 4096;

// ---------------------------------------------------------------------------
// .env loader — runs once at module load time
// ---------------------------------------------------------------------------

/**
 * Reads the .env file from the current working directory and injects any keys
 * that are not already set in process.env. This means shell-level env vars
 * always win over .env values, matching standard dotenv behaviour.
 *
 * Uses synchronous fs so it completes before any config is read.
 * Silently skips if the file doesn't exist.
 */
function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env");
  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch {
    return; // no .env file — that's fine
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    // Only set if not already in the environment
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(eqIdx + 1);
    // Strip surrounding quotes
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnv();

/**
 * Parses a numeric environment variable. Returns the parsed number, or null if
 * the variable is not set. Exits with code 1 if the value is set but invalid
 * (NaN or non-positive).
 */
function parsePositiveInt(name: string, raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) {
    process.stderr.write(
      `[ollama-mcp-bridge] ERROR: ${name} must be a positive integer, got: "${raw}"\n`
    );
    process.exit(1);
  }
  return parsed;
}

/**
 * Parses BRIDGE_CAPABILITY_MAP from a JSON string. On parse error, logs to
 * stderr and returns an empty map (graceful degradation per Req 6.5).
 */
function parseCapabilityMap(raw: string | undefined): CapabilityMap {
  if (raw === undefined || raw === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      process.stderr.write(
        `[ollama-mcp-bridge] ERROR: BRIDGE_CAPABILITY_MAP must be a JSON object, got: ${raw}\n`
      );
      return {};
    }
    return parsed as CapabilityMap;
  } catch {
    process.stderr.write(
      `[ollama-mcp-bridge] ERROR: Failed to parse BRIDGE_CAPABILITY_MAP as JSON: ${raw}\n`
    );
    return {};
  }
}

/**
 * Parses OLLAMA_MODEL_OPTIONS from a JSON string.
 * Accepts only known numeric/boolean fields; unknown keys are silently dropped.
 * On parse error, logs to stderr and returns undefined (graceful degradation).
 */
function parseModelOptions(raw: string | undefined): ModelOptions | undefined {
  if (raw === undefined || raw === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(
      `[ollama-mcp-bridge] ERROR: Failed to parse OLLAMA_MODEL_OPTIONS as JSON: ${raw}\n`
    );
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    process.stderr.write(
      `[ollama-mcp-bridge] ERROR: OLLAMA_MODEL_OPTIONS must be a JSON object, got: ${raw}\n`
    );
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  const opts: ModelOptions = {};
  const numFields: (keyof ModelOptions)[] = [
    "temperature", "top_p", "top_k", "repeat_penalty", "seed", "num_predict", "min_p", "tfs_z",
  ];
  for (const key of numFields) {
    if (key in obj && typeof obj[key] === "number") {
      (opts as Record<string, unknown>)[key] = obj[key];
    }
  }
  return Object.keys(opts).length > 0 ? opts : undefined;
}

/**
 * Reads all environment variables, validates types, and returns a fully
 * populated BridgeConfig. Exits with code 1 on invalid required values.
 *
 * Requirements: 6.3, 6.5, 14.2
 */
export function loadConfig(): BridgeConfig {
  const env = process.env;

  const ollamaBaseUrl = env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
  const defaultModel = env["OLLAMA_DEFAULT_MODEL"] ?? "llama3.1:8b";
  const keepAlive = env["OLLAMA_KEEP_ALIVE"] ?? "10m";

  const contextWindow = parsePositiveInt(
    "OLLAMA_CONTEXT_WINDOW",
    env["OLLAMA_CONTEXT_WINDOW"],
    4096
  );
  const numParallel = parsePositiveInt(
    "OLLAMA_NUM_PARALLEL",
    env["OLLAMA_NUM_PARALLEL"],
    1
  );
  const queueMaxSize = parsePositiveInt(
    "BRIDGE_QUEUE_MAX_SIZE",
    env["BRIDGE_QUEUE_MAX_SIZE"],
    10
  );
  const requestTimeoutMs = parsePositiveInt(
    "BRIDGE_REQUEST_TIMEOUT_MS",
    env["BRIDGE_REQUEST_TIMEOUT_MS"],
    300000
  );
  const maxContextFiles = parsePositiveInt(
    "BRIDGE_MAX_CONTEXT_FILES",
    env["BRIDGE_MAX_CONTEXT_FILES"],
    DEFAULT_MAX_CONTEXT_FILES
  );
  const maxFileTokens = parsePositiveInt(
    "BRIDGE_MAX_FILE_TOKENS",
    env["BRIDGE_MAX_FILE_TOKENS"],
    DEFAULT_MAX_FILE_TOKENS
  );
  const maxTotalContextTokens = parsePositiveInt(
    "BRIDGE_MAX_TOTAL_CONTEXT_TOKENS",
    env["BRIDGE_MAX_TOTAL_CONTEXT_TOKENS"],
    DEFAULT_MAX_TOTAL_CONTEXT_TOKENS
  );

  const allowedDirsRaw = env["BRIDGE_ALLOWED_DIRS"];
  const allowedDirsExplicit = !!(allowedDirsRaw && allowedDirsRaw.trim() !== "");
  const allowedDirs =
    allowedDirsRaw && allowedDirsRaw.trim() !== ""
      ? allowedDirsRaw.split(",").map((d) => d.trim()).filter(Boolean)
      : [process.cwd()];

  // Empty string means "use built-in default" — SystemPromptInjector handles that.
  const systemPrompt = env["BRIDGE_SYSTEM_PROMPT"] ?? "";

  const capabilityMap = parseCapabilityMap(env["BRIDGE_CAPABILITY_MAP"]);

  const fallbackModelsRaw = env["BRIDGE_FALLBACK_MODELS"];
  const fallbackModels =
    fallbackModelsRaw && fallbackModelsRaw.trim() !== ""
      ? fallbackModelsRaw.split(",").map((m) => m.trim()).filter(Boolean)
      : [];

  const reductionLogPath = env["BRIDGE_REDUCTION_LOG"] ?? "./ollama-bridge-reductions.jsonl";

  const logLevelRaw = env["BRIDGE_LOG_LEVEL"] ?? "info";
  const logLevel: "info" | "debug" = logLevelRaw === "debug" ? "debug" : "info";

  const disableProgress = env["BRIDGE_DISABLE_PROGRESS"] === "true";
  const keepAliveOnStart = env["BRIDGE_KEEPALIVE_ON_START"] === "true";

  const benchmarkOutputFile = env["BENCHMARK_OUTPUT_FILE"];
  const patternsFilePath = env["BRIDGE_PATTERNS_FILE"];
  const modelOptions = parseModelOptions(env["OLLAMA_MODEL_OPTIONS"]);
  const autoRetryOnOverflow = env["BRIDGE_AUTO_RETRY_OVERFLOW"] === "true";
  const flashAttention = env["OLLAMA_FLASH_ATTENTION"] === "1";

  return {
    ollamaBaseUrl,
    defaultModel,
    contextWindow,
    keepAlive,
    keepAliveOnStart,
    allowedDirs,
    allowedDirsExplicit,
    systemPrompt,
    capabilityMap,
    fallbackModels,
    queueMaxSize,
    numParallel,
    requestTimeoutMs,
    maxContextFiles,
    maxFileTokens,
    maxTotalContextTokens,
    reductionLogPath,
    logLevel,
    disableProgress,
    autoRetryOnOverflow,
    flashAttention,
    ...(benchmarkOutputFile !== undefined ? { benchmarkOutputFile } : {}),
    ...(patternsFilePath !== undefined ? { patternsFilePath } : {}),
    ...(modelOptions !== undefined ? { modelOptions } : {}),
  };
}
