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
}
//# sourceMappingURL=client.d.ts.map