import type { GenerateRequest, GenerateResponse } from "../types.js";

export type OllamaErrorCode =
  | "service_unavailable"
  | "model_not_found"
  | "local_resource_exhausted";

/** Interface for the Ollama HTTP client — use this in dependency injection so tests can pass plain objects. */
export interface IOllamaClient {
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  listModels(): Promise<string[]>;
  ping(model: string): Promise<{ loaded: boolean; responseTimeMs: number }>;
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

export class OllamaError extends Error {
  code: OllamaErrorCode;

  constructor(message: string, code: OllamaErrorCode) {
    super(message);
    this.name = "OllamaError";
    this.code = code;
  }
}

const MEMORY_KEYWORDS = ["out of memory", "cuda out of memory", "not enough memory"];

function isMemoryError(body: string): boolean {
  const lower = body.toLowerCase();
  return MEMORY_KEYWORDS.some((kw) => lower.includes(kw));
}

export class OllamaClient {
  private baseUrl: string;
  private keepAlive: string;

  constructor(baseUrl: string, keepAlive: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.keepAlive = keepAlive;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const url = `${this.baseUrl}/api/generate`;
    const body = {
      ...req,
      keep_alive: this.keepAlive,
      stream: false,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("fetch failed") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("ECONNRESET")
      ) {
        throw new OllamaError(`Ollama not available at ${this.baseUrl}`, "service_unavailable");
      }
      throw err;
    }

    const text = await response.text();

    if (!response.ok) {
      if (response.status === 404 || text.toLowerCase().includes("model not found")) {
        const modelName = req.model;
        throw new OllamaError(`Model '${modelName}' not found in Ollama`, "model_not_found");
      }

      if (response.status === 500 && isMemoryError(text)) {
        throw new OllamaError(text, "local_resource_exhausted");
      }

      // Check body for model not found even on non-404 status
      if (text.toLowerCase().includes("model not found")) {
        throw new OllamaError(`Model '${req.model}' not found in Ollama`, "model_not_found");
      }

      throw new OllamaError(text, "service_unavailable");
    }

    return JSON.parse(text) as GenerateResponse;
  }

  async listModels(): Promise<string[]> {
    const url = `${this.baseUrl}/api/tags`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("fetch failed") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("ECONNRESET")
      ) {
        throw new OllamaError(`Ollama not available at ${this.baseUrl}`, "service_unavailable");
      }
      throw err;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new OllamaError(text, "service_unavailable");
    }

    const data = (await response.json()) as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  }

  async ping(model: string): Promise<{ loaded: boolean; responseTimeMs: number }> {
    const start = Date.now();

    let responseData: GenerateResponse;
    try {
      responseData = await this.generate({
        model,
        prompt: "",
        keep_alive: this.keepAlive,
        stream: false,
      });
    } catch (err) {
      throw err;
    }

    const responseTimeMs = Date.now() - start;

    // Model is considered "loaded" (warm) if:
    // - Response came back quickly (< 2000ms), OR
    // - load_duration in the response is 0 or very small (< 100ms in nanoseconds = 100_000_000 ns)
    const loadDuration = (responseData as GenerateResponse & { load_duration?: number }).load_duration ?? null;
    const loaded =
      responseTimeMs < 2000 ||
      (loadDuration !== null && loadDuration < 100_000_000);

    return { loaded, responseTimeMs };
  }

  async showModel(model: string): Promise<OllamaModelInfo> {
    const url = `${this.baseUrl}/api/show`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, verbose: true }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("fetch failed") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("ECONNRESET")
      ) {
        throw new OllamaError(`Ollama not available at ${this.baseUrl}`, "service_unavailable");
      }
      throw err;
    }

    if (!response.ok) {
      // Non-fatal — return empty info rather than crashing the benchmark
      return { parameters: "", details: {}, modelInfoRaw: {}, parsedParameters: {} };
    }

    const data = (await response.json()) as {
      parameters?: string;
      details?: {
        format?: string;
        family?: string;
        parameter_size?: string;
        quantization_level?: string;
      };
      model_info?: Record<string, unknown>;
    };

    const rawParams = data.parameters ?? "";
    const parsedParameters: Record<string, string> = {};
    for (const line of rawParams.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) continue;
      const key = trimmed.slice(0, spaceIdx).trim();
      const value = trimmed.slice(spaceIdx + 1).trim();
      if (key) parsedParameters[key] = value;
    }

    return {
      parameters: rawParams,
      details: data.details ?? {},
      modelInfoRaw: data.model_info ?? {},
      parsedParameters,
    };
  }
}
