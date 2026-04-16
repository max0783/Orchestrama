import type { BridgeConfig, CapabilityMap } from "./types.js";

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

  const allowedDirsRaw = env["BRIDGE_ALLOWED_DIRS"];
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

  return {
    ollamaBaseUrl,
    defaultModel,
    contextWindow,
    keepAlive,
    keepAliveOnStart,
    allowedDirs,
    systemPrompt,
    capabilityMap,
    fallbackModels,
    queueMaxSize,
    numParallel,
    requestTimeoutMs,
    reductionLogPath,
    logLevel,
    disableProgress,
    ...(benchmarkOutputFile !== undefined ? { benchmarkOutputFile } : {}),
  };
}
