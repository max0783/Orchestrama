/**
 * Shared type definitions for Orchestrama.
 */

/** Maps task-type keywords/patterns to specific Ollama model names. */
export type CapabilityMap = Record<string, string>;

/** Task types detected from prompt content for system prompt selection. */
export type TaskType = "code_review" | "log_analysis" | "summarization" | "generic";

/** Full bridge configuration, populated from environment variables at startup. */
export interface BridgeConfig {
  /** OLLAMA_BASE_URL — default "http://localhost:11434" */
  ollamaBaseUrl: string;
  /** OLLAMA_DEFAULT_MODEL — default "llama3.1:8b" */
  defaultModel: string;
  /** OLLAMA_CONTEXT_WINDOW — default 4096 */
  contextWindow: number;
  /** OLLAMA_KEEP_ALIVE — default "10m" */
  keepAlive: string;
  /** BRIDGE_KEEPALIVE_ON_START — default false */
  keepAliveOnStart: boolean;
  /** BRIDGE_ALLOWED_DIRS — comma-separated; default [process.cwd()] */
  allowedDirs: string[];
  /**
   * True when BRIDGE_ALLOWED_DIRS was explicitly set in the environment.
   * False when defaulting to [process.cwd()].
   * Used by declare_working_dirs to determine security policy.
   */
  allowedDirsExplicit: boolean;
  /** BRIDGE_SYSTEM_PROMPT — or built-in default */
  systemPrompt: string;
  /** BRIDGE_CAPABILITY_MAP — JSON string parsed to map */
  capabilityMap: CapabilityMap;
  /** BRIDGE_FALLBACK_MODELS — comma-separated */
  fallbackModels: string[];
  /** BRIDGE_QUEUE_MAX_SIZE — default 10 */
  queueMaxSize: number;
  /** OLLAMA_NUM_PARALLEL — default 1 */
  numParallel: number;
  /** BRIDGE_REQUEST_TIMEOUT_MS — default 300000 */
  requestTimeoutMs: number;
  /** BRIDGE_REDUCTION_LOG — default "./ollama-bridge-reductions.jsonl" */
  reductionLogPath: string;
  /** BRIDGE_LOG_LEVEL — "info" | "debug" */
  logLevel: "info" | "debug";
  /** BRIDGE_DISABLE_PROGRESS — default false */
  disableProgress: boolean;
  /** BRIDGE_MAX_CONTEXT_FILES — default 20 */
  maxContextFiles?: number;
  /** BRIDGE_MAX_FILE_TOKENS — default 1024 */
  maxFileTokens?: number;
  /** BRIDGE_MAX_TOTAL_CONTEXT_TOKENS — default 4096 */
  maxTotalContextTokens?: number;
  /** BENCHMARK_OUTPUT_FILE — optional */
  benchmarkOutputFile?: string;
  /** BRIDGE_PATTERNS_FILE — optional path for persisting custom patterns */
  patternsFilePath?: string;
  /** OLLAMA_MODEL_OPTIONS — JSON object of fine-tuning options (temperature, top_p, etc.) */
  modelOptions?: ModelOptions;
  /**
   * BRIDGE_AUTO_RETRY_OVERFLOW — when true, automatically retry a request
   * with a halved context window if the payload exceeds the current window,
   * rather than returning an error immediately.
   */
  autoRetryOnOverflow?: boolean;
  /**
   * OLLAMA_FLASH_ATTENTION — when true, sets OLLAMA_FLASH_ATTENTION=1 in .env.
   * Takes effect only after Ollama is restarted (Ollama reads this at startup).
   */
  flashAttention?: boolean;
}

/** A named, reusable usage pattern that maps an intent to a system prompt and model preference. */
export interface UsagePattern {
  name: string;               // unique identifier, kebab-case
  description: string;        // human-readable description
  systemPrompt: string;       // the instruction set for the model
  modelPreference?: string;   // optional preferred model
  keywords: string[];         // alias strings for intent matching
  isBuiltIn: boolean;         // true = cannot be overwritten/deleted
}

/** Array of these objects written to BRIDGE_PATTERNS_FILE. */
export interface PersistedPattern {
  name: string;
  description: string;
  systemPrompt: string;
  modelPreference?: string;
  keywords: string[];
  // isBuiltIn is always false for persisted patterns; not stored
}

/** Request body sent to Ollama /api/generate. */
export interface GenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  /** KV-cache token array from a previous turn; null resets context. */
  context?: number[] | null;
  keep_alive?: string;
  stream?: boolean;
  /** Runtime options passed to Ollama (e.g. num_ctx, temperature). */
  options?: Record<string, unknown>;
}

/** Response body from Ollama /api/generate. */
export interface GenerateResponse {
  model: string;
  response: string;
  /** Returned KV-cache token array. */
  context: number[];
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

/** Result of reading a single file for context injection. */
export interface FileReadResult {
  path: string;
  content: string | null;
  /** Human-readable error, e.g. "file not found" or "SECURITY ERROR: ..." */
  error?: string;
  tokenEstimate: number;
}

/** Result returned by the Map-Reduce chunker. */
export interface ChunkResult {
  finalResponse: string;
  chunksUsed: number;
  wasChunked: boolean;
}

/** A single line in the reduction log (.jsonl). */
export interface ReductionRecord {
  /** ISO 8601 timestamp */
  timestamp: string;
  tool: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** outputTokens / inputTokens */
  reductionRatio: number;
  taskType: string;
  chunked: boolean;
  /** First 200 chars of input payload — only when BRIDGE_LOG_LEVEL=debug */
  inputPreview?: string;
  /** First 200 chars of output response — only when BRIDGE_LOG_LEVEL=debug */
  outputPreview?: string;
}

/** Current state of the request queue. */
export interface QueueStatus {
  queueLength: number;
  activeRequests: number;
  concurrencyLimit: number;
}

/**
 * Fine-tuning options forwarded to Ollama's /api/generate `options` field.
 * All fields are optional — only set values are sent.
 */
export interface ModelOptions {
  /** Sampling temperature (0.0–2.0). Lower = more deterministic. Default: model default */
  temperature?: number;
  /** Top-p nucleus sampling (0.0–1.0). Default: model default */
  top_p?: number;
  /** Top-k sampling. 0 = disabled. Default: model default */
  top_k?: number;
  /** Penalise repeated tokens (1.0 = no penalty). Default: model default */
  repeat_penalty?: number;
  /** Fixed random seed for reproducible outputs. -1 = random. Default: -1 */
  seed?: number;
  /** Maximum tokens to generate. -1 = model default. */
  num_predict?: number;
  /** Minimum probability for a token to be considered. Default: model default */
  min_p?: number;
  /** Tail-free sampling parameter. Default: model default */
  tfs_z?: number;
}
