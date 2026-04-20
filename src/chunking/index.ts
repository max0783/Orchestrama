import type { GenerateRequest, GenerateResponse, ChunkResult, ModelOptions } from "../types.js";

export type ProgressCallback = (event: ProgressEvent) => void;

export type ProgressEvent =
  | { type: "chunk_done"; index: number; total: number; elapsedMs: number }
  | { type: "reducing"; summaryCount: number }
  | { type: "started"; estimatedChunks: number };

export interface ChunkingOptions {
  contextWindow: number;
  systemPromptTokens: number;
  model: string;
  /** Fine-tuning options forwarded to Ollama (temperature, top_p, etc.) */
  modelOptions?: ModelOptions;
}

/**
 * Estimates the number of tokens in a string using the formula: floor(length / 4).
 * Requirements: 4.1
 */
export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/**
 * Splits a payload string into chunks where each chunk's token estimate <= maxTokens.
 * Splits on word boundaries (spaces/newlines) when possible.
 * If a single word exceeds maxTokens, force-splits it.
 * Requirements: 4.2
 */
export function splitIntoChunks(payload: string, maxTokens: number): string[] {
  if (maxTokens <= 0) {
    // Degenerate case: force-split into single characters
    return payload.split("").filter((c) => c.length > 0);
  }

  if (estimateTokens(payload) <= maxTokens) {
    return [payload];
  }

  const chunks: string[] = [];
  // maxChars is the maximum number of characters per chunk
  const maxChars = maxTokens * 4;

  let remaining = payload;

  while (remaining.length > 0) {
    if (estimateTokens(remaining) <= maxTokens) {
      chunks.push(remaining);
      break;
    }

    // Try to split on a word boundary within maxChars
    let splitAt = maxChars;

    if (splitAt >= remaining.length) {
      chunks.push(remaining);
      break;
    }

    // Look backwards from splitAt for a space or newline
    let boundaryIdx = -1;
    for (let i = splitAt; i >= 0; i--) {
      if (remaining[i] === " " || remaining[i] === "\n") {
        boundaryIdx = i;
        break;
      }
    }

    if (boundaryIdx > 0) {
      // Split at the word boundary
      chunks.push(remaining.slice(0, boundaryIdx));
      remaining = remaining.slice(boundaryIdx + 1); // skip the space/newline
    } else {
      // No word boundary found — force-split at maxChars
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Builds the Ollama `options` object from ChunkingOptions.modelOptions,
 * also injecting num_ctx from contextWindow so Ollama uses the right KV cache size.
 */
function buildOllamaOptions(opts: ChunkingOptions): Record<string, unknown> | undefined {
  const base: Record<string, unknown> = { num_ctx: opts.contextWindow };
  if (!opts.modelOptions) return base;
  return { ...base, ...opts.modelOptions };
}

/**
 * Map-Reduce chunker that processes large payloads by splitting into chunks,
 * summarizing each chunk independently (Map phase), then recursively reducing
 * the summaries (Reduce phase).
 * Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */
export class Chunker {
  constructor(
    private ollamaGenerate: (
      req: GenerateRequest,
      options?: { signal?: AbortSignal }
    ) => Promise<GenerateResponse>
  ) {}

  async process(
    payload: string,
    systemPrompt: string,
    opts: ChunkingOptions,
    onProgress: ProgressCallback,
    depth = 0,
    abortSignal?: AbortSignal
  ): Promise<ChunkResult> {
    // Recursion guard — Requirements: 4.7
    if (depth >= 10) {
      return {
        finalResponse:
          "[WARNING: max recursion depth reached, result may be incomplete]\n" +
          payload.slice(0, 1000),
        chunksUsed: 0,
        wasChunked: true,
      };
    }

    const tokens = estimateTokens(payload + systemPrompt);

    // If payload fits in context window, make a single call
    if (tokens <= opts.contextWindow * 0.9) {
      const response = await this.ollamaGenerate({
        model: opts.model,
        prompt: payload,
        system: systemPrompt,
        context: null,
        stream: false,
        options: buildOllamaOptions(opts),
      }, { signal: abortSignal });
      return {
        finalResponse: response.response,
        chunksUsed: 1,
        wasChunked: false,
      };
    }

    // Map phase: split into chunks and summarize each independently
    const maxChunkTokens =
      Math.floor(opts.contextWindow * 0.9) - opts.systemPromptTokens;
    const chunks = splitIntoChunks(payload, maxChunkTokens);

    onProgress({ type: "started", estimatedChunks: chunks.length });

    const summaries: string[] = [];
    const startTime = Date.now();

    for (let i = 0; i < chunks.length; i++) {
      // IMPORTANT: context is always null for each Map phase call — Requirements: 4.4
      const response = await this.ollamaGenerate({
        model: opts.model,
        prompt: chunks[i],
        system: systemPrompt,
        context: null,
        stream: false,
        options: buildOllamaOptions(opts),
      }, { signal: abortSignal });
      summaries.push(response.response);
      onProgress({
        type: "chunk_done",
        index: i + 1,
        total: chunks.length,
        elapsedMs: Date.now() - startTime,
      });
    }

    // Reduce phase: join summaries and recurse
    const reducedInput = summaries.join("\n---\n");
    onProgress({ type: "reducing", summaryCount: summaries.length });

    return this.process(reducedInput, systemPrompt, opts, onProgress, depth + 1, abortSignal);
  }
}
