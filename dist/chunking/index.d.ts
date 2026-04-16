import type { GenerateRequest, GenerateResponse, ChunkResult } from "../types.js";
export type ProgressCallback = (event: ProgressEvent) => void;
export type ProgressEvent = {
    type: "chunk_done";
    index: number;
    total: number;
    elapsedMs: number;
} | {
    type: "reducing";
    summaryCount: number;
} | {
    type: "started";
    estimatedChunks: number;
};
export interface ChunkingOptions {
    contextWindow: number;
    systemPromptTokens: number;
    model: string;
}
/**
 * Estimates the number of tokens in a string using the formula: floor(length / 4).
 * Requirements: 4.1
 */
export declare function estimateTokens(text: string): number;
/**
 * Splits a payload string into chunks where each chunk's token estimate <= maxTokens.
 * Splits on word boundaries (spaces/newlines) when possible.
 * If a single word exceeds maxTokens, force-splits it.
 * Requirements: 4.2
 */
export declare function splitIntoChunks(payload: string, maxTokens: number): string[];
/**
 * Map-Reduce chunker that processes large payloads by splitting into chunks,
 * summarizing each chunk independently (Map phase), then recursively reducing
 * the summaries (Reduce phase).
 * Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */
export declare class Chunker {
    private ollamaGenerate;
    constructor(ollamaGenerate: (req: GenerateRequest) => Promise<GenerateResponse>);
    process(payload: string, systemPrompt: string, opts: ChunkingOptions, onProgress: ProgressCallback, depth?: number): Promise<ChunkResult>;
}
//# sourceMappingURL=index.d.ts.map