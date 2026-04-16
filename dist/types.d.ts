/**
 * Shared type definitions for ollama-mcp-bridge.
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
    /** BENCHMARK_OUTPUT_FILE — optional */
    benchmarkOutputFile?: string;
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
//# sourceMappingURL=types.d.ts.map