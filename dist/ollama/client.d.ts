import type { GenerateRequest, GenerateResponse } from "../types.js";
export type OllamaErrorCode = "service_unavailable" | "model_not_found" | "local_resource_exhausted";
/** Interface for the Ollama HTTP client — use this in dependency injection so tests can pass plain objects. */
export interface IOllamaClient {
    generate(req: GenerateRequest): Promise<GenerateResponse>;
    listModels(): Promise<string[]>;
    ping(model: string): Promise<{
        loaded: boolean;
        responseTimeMs: number;
    }>;
    showModel(model: string): Promise<OllamaModelInfo>;
}
/** Parsed model info from /api/show */
export interface OllamaModelInfo {
    /** Raw parameter string, e.g. "temperature 0.8\nnum_ctx 4096" */
    parameters: string;
    details: {
        format?: string;
        family?: string;
        parameter_size?: string;
        quantization_level?: string;
    };
    /** Raw model_info map from /api/show (architecture-specific fields) */
    modelInfoRaw: Record<string, unknown>;
    /** Parsed key→value map from the parameters string */
    parsedParameters: Record<string, string>;
}
export declare class OllamaError extends Error {
    code: OllamaErrorCode;
    constructor(message: string, code: OllamaErrorCode);
}
export declare class OllamaClient {
    private baseUrl;
    private keepAlive;
    constructor(baseUrl: string, keepAlive: string);
    generate(req: GenerateRequest): Promise<GenerateResponse>;
    listModels(): Promise<string[]>;
    ping(model: string): Promise<{
        loaded: boolean;
        responseTimeMs: number;
    }>;
    showModel(model: string): Promise<OllamaModelInfo>;
}
//# sourceMappingURL=client.d.ts.map